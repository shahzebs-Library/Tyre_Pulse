# Commercial blockers: design notes and readiness checklists

Date 2026-11-15. Stream COMMERCIAL2. Nothing here is switched on. Single-company mode and plan
enforcement are unchanged in production. "Proven on staging" means the local PostgreSQL 16 copy with
three synthetic companies; it is not production and not a hosted Supabase project.

Words: **exists** = in production or on main today. **drafted** = a file in `supabase/pending_migrations`
or a document, not applied. **missing** = not written. **needs** = someone other than engineering.

---

## TEN-6 Plan limits

Design. One switch, `system_config.entitlement_enforcement`, inserted `off` by TEN-6. With it off every
function answers as production does today. TEN-6 gives every company that exists at apply time an explicit
`internal` plan row (all features, no limits): that row is the grandfathering.

New in round 2 (`20261115160000`): `entitlement_enforcement_preflight()` lists, per company, plan, standing,
usage against limits and what the switch would refuse; `admin_set_entitlement_enforcement()` is the only
supported way to turn it on and refuses when the current company would be limited; a trigger refuses a
direct write of the switch by a signed-in user.

| | |
|---|---|
| Proven on staging | Current company with no subscription row, 52 vehicles and 9 members (trial caps 25 and 3): after TEN-6 it holds `internal`; with the switch ON an Admin still adds a vehicle; permission map and capability matrix identical to the baseline. Trial company at 25 vehicles: 26th refused. Company whose trial ended: adds a vehicle with the switch off, refused with it on. Switch refused while the current company sits on a plan it exceeds. 21 tests |
| Found | Limits already apply with the switch OFF to any company that has a subscription row (TEN-6 behaviour, closes the "one Billing click creates a trial" trap). The preflight also reports modules a plan excludes: on staging both other companies lose `erp_sync`, so turning the switch on needs an explicit acknowledgement |
| Not tested | The Billing page rendering plan "Internal". Timing of `app_user_can` with the switch on. Production |
| Needs the owner | Confirm every existing organisation receives `internal` (5 exist in production). Decide the grace length for `past_due`. Decide which modules belong to which plan (none is mapped yet beyond the five plan feature keys) |

## TEN-7 Role matrix per company

Design. Storage is unchanged and no row moves. A global row of a built-in role is the platform default. A
global row of a custom role belongs to the legacy (current) company only. A row with a company id is that
company's own setting and wins. TEN-7 already resolves access this way; round 2 (`20261115161000`) makes
the TABLE readable the same way: a company reads its own rows and the built-in defaults, nothing else.
`get_org_role_matrix()` returns the effective matrix with the source of each cell for a company Admin
screen. `admin_seed_org_role_matrix()` copies the defaults into own rows; nothing calls it.

| | |
|---|---|
| Proven on staging | `get_user_module_permissions()` md5 identical before and after for all 9 current-company users (Admin, Manager, Director, Driver, Inspector, Tyre Man, the two custom roles, super admin), after every step. Current company still reads all 585 rows. Second company reads 325 (built-in only) and 0 rows of the current company's custom role. Own row wins, labelled `own`; the edit does not change the current company; a third company cannot read it. Seed leaves effective permissions identical. 16 tests |
| Not tested | The console Access Control screens and `onboardingReadiness` against the narrowed table (source read only). A company Admin screen for its own matrix does not exist |
| Needs the owner | D1: does a new company inherit the defaults live (a later platform change reaches it) or start from a copy (it does not)? The draft supports both; nothing is chosen |
| Still open | Platform changes to the defaults reach every inheriting company at once. That is what "default" means, but it should be a stated rule |

## TEN-8 Sign-up

Design. A person lands in a company only through a single-use, expiring invitation token (TEN-9). Round 2
(`20261115162000`) adds: a preview of the invitation before sign-in (company name and role), a short
company code, and the rule that a code alone never grants membership and never falls back to the current
company. With single-company mode ON and neither field sent, the sign-up takes the same branch as today.

| | |
|---|---|
| Proven on staging | No invitation, mode on: current company, Reporter, pending, identical to the baseline. Valid token: invited company, role, approved. Token plus another company's code: no company, token stays unused. Used, expired, revoked-by-lock tokens: no company. Code only: no company in both modes. Mode off, no token: no company. Super admin creates a company with one call; its Admin sees 0 foreign vehicles and adds its first vehicle. 27 tests |
| Found | The owner invitation is tied to the owner's e-mail, and the web sign-up form creates a made-up address from the username, so the owner cannot redeem it through today's form (shown by a test). Member invitations with no e-mail work |
| Missing | Client: `?invite=<token>` handling on the web and Flutter sign-up forms (preview, pass `invite_token`). A real e-mail sign-up path for the owner. Redeeming an invitation with an account that already exists (refused by the privileged-column guard; not weakened) |
| Needs the owner | D2: may an owner invitation be untied from an e-mail, or must the owner sign up with a real address? `get_invitation_preview` would be one more function callable before sign-in |

## TEN-9 Usernames

Plan. Three stages, the first two change nothing for anyone.

1. (TEN-9, drafted) per-company unique keys on username and employee id, added beside the global ones.
2. (`20261115163000`, drafted) one sign-in resolver. A bare name is looked up across all companies as
   today; if several companies hold it, the current company's account wins, otherwise nothing is returned.
   `company code/name` looks inside that company. The existing single text field carries it, so no screen
   changes, including the frozen Expo build.
3. (`20261115169000`, HOLD) remove the five global keys. Point of no easy return.

| | |
|---|---|
| Proven on staging | All 27 username, employee id and upper-case lookups of the current company resolve exactly as before (they do resolve: field accounts were given made-up addresses first). `slug/name`, short code, either slash, any case. Wrong company, unknown code: nothing. Before the hold: a second company cannot take an existing name (refused, lands nowhere). After the hold: it can; the bare name still signs in the current-company user; `code/name` signs in the other; a name shared by two new companies resolves nothing without a code; a duplicate inside one company is still refused; the global key cannot be put back once a duplicate exists. 23 tests |
| Found | A constraint the earlier drafts did not name: the sign-up forms build the account address as `<username>@users.tyrepulse.app` and account addresses are unique platform-wide. A second company needs `<username>+<company code>@users.tyrepulse.app` |
| Missing | `supabase/functions/sign-in/index.ts` must call `resolve_sign_in_user` (it resolves real-e-mail accounts with its own queries). Sign-up forms must build the new address. Neither is edited |
| Not tested | Real Auth, the edge function, any client |

---

## Subscription enforcement

| | |
|---|---|
| Exists | `subscription_plans` (4 public plans), `get_subscription_overview`, `org_can_add`, trigger `enforce_plan_limit` on vehicles and API keys (inert without a subscription row). Client: `src/lib/subscriptionAccess.js`, `SubscriptionGate.jsx`, `entitlements.js` (banner and block, admins never hard-blocked). 0 subscription rows and 0 invoices in production. Billing webhook deployed |
| Drafted | TEN-5, TEN-5b (a customer cannot write its plan), TEN-6 (one server decision behind a switch, seat limit at approval), TEN-6b (preflight and guarded switch) |
| Missing | Write blocking for an expired company on tables whose legacy role policies allow the write (TEN-6 states it). Clients do not call `get_my_entitlements()`. Plan to module mapping. Trial-ending notices |
| Needs | Owner: plan for existing organisations, grace length, module mapping. Outside: a live Stripe account and prices before any paid plan can activate (checkout is unconfigured) |

## Onboarding (first company without super-admin SQL)

| | |
|---|---|
| Exists | Console user approval. `create_workspace_owner` exists in the repository and is deliberately not applied (open self-serve sign-up) |
| Drafted | `admin_provision_organisation` (TEN-9): company, subscription and owner invitation in one transaction, proven on staging. Invitation preview and company code (TEN-8b). Role matrix seed (TEN-7c) |
| Missing | A console page that calls `admin_provision_organisation` and shows the invitation link once. The seed for a new company (sites, departments, checklist templates, accident routing): TEN-9 calls `_seed_new_organisation` only if it exists, and it does not. The invitation sign-up forms. Sending the invitation by e-mail |
| Needs | Owner: what a new company starts with. A hosted staging project to run the flow through real Auth |

## Backup recovery

| | |
|---|---|
| Exists (from PR #509, read on production) | Nightly in-database snapshot of 7 small tables, 14 nights, 0 failures in 30 days. Two restore tests, one table of 36 rows each. Continuous change-log archiving to the platform is on |
| Drafted | `20261113142000` (PR #509): 21 more small tables, a restore test over every captured table, `health_ping()` for an outside monitor. `docs/runbooks/BACKUP_AND_RESTORE_STATUS.md` |
| Missing | Any backup of the expense ledger, job card lines, production, users, or the 27,287 storage files. A restore of a single company's data. A timed restore of the whole database into a new project |
| Must be confirmed in the Supabase dashboard (Database, Backups) by the owner | The plan. Whether daily backups are listed and for how many days. Whether point-in-time recovery is on and its retention. Whether restore to a new project is offered. Whether storage files are covered by anything |
| A tested restore needs | A second (staging) project; a restore to a named minute; row counts and checksums compared with a note taken beforehand; the elapsed time written down as the recovery time; storage files checked separately. None of this has been done |

## Privacy

Data map per processor (source: `src/lib/privacyProcessors.js` in PR #509, each checked in the code):

| Processor | Receives | In use |
|---|---|---|
| Supabase | everything stored | yes |
| Vercel | IP and browser details | yes |
| Anthropic | tyre photos, assistant questions and the figures needed to answer | yes |
| Google Gemini | the same photo, only with a backup key | unverified |
| OpenAI | knowledge document text and search questions | when used |
| Sentry | errors, user id, role, site, masked screen recording on error | yes |
| PostHog | page and click events, user id, role, site | only with a key, unverified |
| Resend | recipient address and e-mail content | yes |
| Firebase Cloud Messaging, Expo push | push token, notification title and text | when devices register |
| Twilio | phone number and message text | only when configured, unverified |
| Open-Meteo, Google Fonts, Cloudflare Turnstile | caller IP (and a city from a fixed list) | Turnstile inert without a key |
| Stripe | not in use | no |

| | |
|---|---|
| Exists | Privacy page, data deletion page, in-app deletion request |
| Drafted | Corrected privacy page driven by one processor list with a drift test (PR #509) |
| Missing | Per-company data export. Per-company purge is a draft, dry-run only, never run on a real database. Data residency statement. Retention periods per data type |
| Legal must review | The page wording. Whether a data processing agreement and a named sub-processor list are owed to customers. Each provider's retention and model-training terms. Cross-border transfer for KSA, UAE and Egypt personal data (driver names, national id on accident records, photos). Deletion timeline promises |

## AI validation

| | |
|---|---|
| Exists | 943 photo jobs in one company, 3 reviewed by a person, 0 expert labels. Adjudication harness and release gate in the repository. Budget cap |
| Drafted | `AI_ACCURACY_VALIDATION_PLAN.md` (PR #510): who labels, how many photos, procedure, pass marks, what may be said at each stage |
| Missing | Every measurement. Prompt v4 is not deployed. Healthy wheels are not screened, so missed defects cannot be counted. Wheel position is not verified from the photo |
| Needs | Owner: two named reviewers and an arbiter, pass marks confirmed before any score is seen, approval of the AI spend. Until then no accuracy statement may be made to a customer |

## Mobile testing

| | |
|---|---|
| Exists | Flutter: analyze clean, 3,678 tests, Android and iOS builds succeed in CI (PR #507). Closed testing track on Play |
| Missing | Any run on a real device in this programme: sign-in, real data, role permissions, small screens, offline capture and sync, push delivery, photo upload on a low-memory phone, Arabic layout |
| Multi-company specific, not built | Invitation link sign-up, the `+<company code>` address, `company code/name` sign-in hint. The Flutter app does not read plan entitlements or module status |
| Needs | Real devices (one low-end Android, one iPhone), a hosted staging project with the synthetic companies, and a tester for each role. No mobile build was made in this stream |
