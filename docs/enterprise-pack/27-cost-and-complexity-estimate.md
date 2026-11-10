# 27 - Cost and Complexity Estimate

- Deliverable 27 of 29
- Date: 2026-11-10
- Status: Estimate only. Nothing in this document is a quote or a measured cost.
- Evidence: effort is engineering judgement against the code that exists today (paths cited in doc 26). Running-cost
  drivers come from `PROJECT_MEMORY.md` and a read-only live check on 2026-11-10 (edge function list, table sizes,
  `shared_buffers`). Vendor prices are indicative public list prices as known to the author (mid 2026) and MUST be
  confirmed on each vendor's pricing page before budgeting.
- Related docs: 26-priority-roadmap.md (ids), 28-risks-and-dependencies.md, 29-change-register.md,
  `docs/MONITORING.md`, `docs/TEST_AND_RELEASE_PLAN.md`.

## Assumptions

1. One engineer-day = one experienced full-stack engineer who already knows this repo (React/Vite, Supabase SQL and
   RLS, Flutter). A new engineer needs roughly 2 to 3 weeks of onboarding first; not included.
2. Each estimate includes: code, migration with rollback, tests, a rolled-back live verification, docs and
   PROJECT_MEMORY update. It excludes owner review time and customer data turnaround.
3. Size bands: S = 0.5 to 2 days, M = 3 to 7, L = 8 to 20, XL = 20 to 60. Ranges are deliberately wide; this
   codebase has repeatedly shown that measurement changes the plan (example: the "42% misclassified" UAE figure was
   2.6% once measured, memory 2026-07-26).
4. Owner/customer items (OWN, OPS, CUS) carry only the engineering follow-up effort, not the waiting time.
5. No precision beyond the ranges below is claimed. Totals are sums of ranges, so they widen.

## Complexity drivers specific to this platform

| Driver | Why it costs time | Example from memory |
|---|---|---|
| Live single production database | Every change is verified in a rolled-back transaction first; no staging DB | V542 to V576 security sweep |
| MCP approval timeouts | A DROP/DELETE in an MCP call waits for approval and rolls back at 60s; needs splitting or SQL editor | 2026-10-07, 2026-11-09 |
| Three clients to keep in step | Web, Flutter, legacy Expo mirrors; JS mirrors of SQL functions ("change both") | `tyreKm.js` vs `tyre_km_life` |
| Parallel sessions on the same repo | Reconciling branches before each merge | 2026-10-11 Workshop Status loops |
| One production build per merge (Vercel) | Work is batched; one merge per session rule | memory "ONE MERGE PER SESSION" |
| RLS performance traps | Helpers must stay InitPlans; DEFINER functions re-check scope | V396, V545-V553 |

## Phase 1 estimate

| Id | Complexity | Engineer-days | Note |
|---|---|---|---|
| R-001 | Low | 0.5 to 1 | Deploy plus byte-diff; repo already holds the code |
| R-002 | Medium | 3 to 5 | Auth path change; must keep LOGIN rows |
| R-003 | Medium | 2 to 4 | Allowlist table + rate limit in edge fn |
| R-004 | Low | 0.5 to 1 | |
| R-005 | Medium | 2 to 4 | Snapshot RPC is large; per-page gating |
| R-006 | Low | 0.5 to 1 | Storage policy |
| R-007 | Medium | 3 to 5 | 208k-row table; must stay InitPlan form |
| R-008 | Low | 0.5 | Rename two files, check DB versions |
| R-009 | Medium | 2 to 4 | Read live bodies with `pg_get_functiondef` |
| R-010 | Low | 1 to 2 | |
| R-011 | Low | 0.5 to 1 | |
| R-012 | Medium | 4 to 7 | Web `safeError.js` exists; Flutter and edge fns align |
| R-013 | Low | 0.5 | |
| R-014 | Low | 0.5 | |
| R-015 | Low | 1 to 2 | Mostly a decision |
| R-020 to R-027 | Low each | 0.5 to 1 each (4 to 8 total) | Engineering follow-up after owner action |
| R-030 to R-041 | Low to Medium | 0.5 to 3 each (8 to 20 total) | Re-import verification, guarded backfills with `_bak` snapshots |
| R-042 | High | 8 to 15 | Country-qualified asset key touches every per-asset join |
| Phase 1 total | | about 42 to 82 engineer-days | Excludes customer turnaround |

## Phase 2 estimate

| Id | Complexity | Engineer-days | Note |
|---|---|---|---|
| R-050 | Very high | 25 to 45 | Hundreds of call sites; parity tests exist for resolver |
| R-051 | High | 10 to 20 | Per-table capability policies, impersonation tests |
| R-052 | Medium | 4 to 7 | |
| R-053 | High | 10 to 18 | 121 decision sites, 361 total (measured 2026-07-27) |
| R-054 | High | 10 to 15 | All server CPK RPCs + ~40 helpers |
| R-055 | Medium | 3 to 6 | |
| R-056 | Medium | 3 to 5 | |
| R-057 | Low | 1 to 2 | |
| R-058 | High | 8 to 15 | Columns used by RLS helpers |
| R-059 | Medium | 3 to 6 | |
| R-060 | High | 8 to 15 | |
| R-061 | Medium | 3 to 6 | |
| R-062 | Medium | 4 to 8 | Device time included |
| R-063 | Medium | 4 to 7 | Sync wiring in `lib/core/sync` |
| R-064 | High | 10 to 20 | iOS signing, parallel validation weeks |
| R-065 | Low | 1 to 2 | |
| Phase 2 total | | about 107 to 197 | |

## Phase 3 estimate

| Id | Complexity | Engineer-days |
|---|---|---|
| R-070 | Very high | 20 to 40 |
| R-071 | High | 10 to 18 |
| R-072 | Very high | 20 to 40 |
| R-073 | High | 8 to 15 |
| R-074 | High | 8 to 15 |
| R-075 | Medium | 3 to 6 |
| R-076 | High | 8 to 15 |
| R-077 | High | 10 to 20 |
| R-078 | Low | 1 to 2 |
| R-079 | Medium | 3 to 6 |
| R-080 | Medium | 4 to 8 |
| R-081 | Medium | 3 to 7 |
| Phase 3 total | | about 98 to 192 |

## Phase 4 estimate

| Id | Complexity | Engineer-days |
|---|---|---|
| R-090 | High | 12 to 20 |
| R-091 | Medium | 4 to 7 |
| R-092 | Low | 1 to 2 |
| R-093 | High | 10 to 20 |
| R-094 | High | 10 to 18 |
| R-095 | Low | 0.5 to 1 |
| R-096 | Medium | 4 to 7 |
| R-097 | Very high | 20 to 35 |
| R-098 | Very high | 20 to 60 per connector family (depends on customer system access) |
| R-099 | Medium | 3 to 6 |
| R-100 | Medium | 4 to 7 |
| R-101 | Medium | 3 to 6 |
| Phase 4 total | | about 91 to 189 (excluding extra connectors) |

## Phase 5 estimate

| Id | Complexity | Engineer-days |
|---|---|---|
| R-110 | High | 8 to 15 |
| R-111 | Medium | 4 to 8 |
| R-112 | High | 8 to 20 (if n8n chosen) |
| R-113 | Medium | 4 to 8 |
| R-114 | High | 8 to 15 |
| R-115 | High | 10 to 18 |
| R-116 | Medium | 3 to 7 |
| R-117 | High | 8 to 15 |
| R-118 | Very high | 25 to 50 |
| R-119 | Low | 1 to 2 |
| R-120 | Low | 1 to 2 |
| R-121 | Low | 0.5 to 1 |
| R-122 | Low | 0.5 to 1 |
| R-123 | Very high | 20 to 40 |
| Phase 5 total | | about 101 to 202 |

## Programme total

| Phase | Engineer-days (range) | Calendar with 2 engineers (rough) |
|---|---|---|
| 1 | 42 to 82 | 1 to 2 months |
| 2 | 107 to 197 | 3 to 5 months |
| 3 | 98 to 192 | 3 to 5 months |
| 4 | 91 to 189 | 2 to 5 months |
| 5 | 101 to 202 | 3 to 5 months |
| Total | about 440 to 860 | 12 to 22 months, phases partly overlap |

Calendar assumes 20 working days per month per engineer and no long customer waits. Phases 3 and 4 can overlap.

## Running-cost drivers (estimates, confirm with vendors)

| Driver | What the repo / memory shows | Cost behaviour | Indicative note |
|---|---|---|---|
| Supabase compute | `shared_buffers` 256 MB (verified live); `audit_log_v2` 654 MB (verified); I/O bound (memory 2026-08-17) | Step cost per compute tier | Upgrading one tier is the main lever (R-020); confirm current plan and tier in the Supabase dashboard |
| Supabase database size | `audit_log_v2` grows ~30,000 rows / ~20 MB per bulk import day (memory) | Linear storage + cache pressure | R-021 decides the growth rate |
| Supabase realtime | WAL decoder was the top DB cost until V582 trimmed the publication (memory 2026-08-17) | CPU on the database | Adding tables to the publication raises it again |
| Supabase PITR / backups | Nightly `backups` snapshot of 8 core tables only (V495); PITR not confirmed | Add-on per retention days | R-116 decides |
| Vercel | Two projects (`tyre-pulse` app, `tyre-pulse-eezl` marketing). Free-plan limit of 100 deployments/day was hit 2026-08-11 and blocked production builds | Plan tier, build minutes | Branch preview suppression in `vercel.json` + one merge per session keeps it inside free limits; a team plan removes the risk |
| AI (Anthropic API via `chat-ai`, `ai-orchestrator`, `ai-tyre-inspection`) | Model hard-coded to a Haiku-class model; monthly budget cap in `system_config` + `budget.ts` fail-closed; 800 AI tyre jobs completed (memory 2026-11-08) | Per token / per photo | Cost is bounded by `ai_monthly_budget_usd`; set it explicitly per tenant |
| Gemini fallback | Optional `AI_PROVIDER_KEY` (memory 2026-10-27) | Per call | Only when configured |
| Sentry | Web + mobile projects, crash alert cron every 15 min | Event volume tier | Fatal-only alerting keeps volume low |
| Resend (email) | `send-email`, scheduled reports, accident routing (now ON), contact form (env vars unset on marketing) | Per email / plan tier | Rate limit 2 req/s seen (memory 2026-07-14) |
| Twilio WhatsApp | Wired in `workflow-notify`, gated by secret | Per message | Not observed in use |
| Expo / EAS | Store builds retired; OTA path only for the installed 1.6.0 binary | Build minutes | Flutter builds run on GitHub Actions instead |
| GitHub Actions | CI web, mobile, Flutter Android + iOS, CodeQL | Minutes (macOS runners cost more) | iOS builds are the expensive minutes |
| Google Play / Apple | Developer accounts | Fixed yearly / one-off | Existing |
| Firebase (FCM) | Push via service account secret | Free tier for FCM | |
| PostHog | Key unset in Vercel, 0 events | Event volume | Free tier likely enough at this size |
| Cloudflare Turnstile | Wired, inert | Free tier | |
| Maps provider | Not chosen (deferred) | Per map load | Needed for R-123 |

## Open decisions for the owner

- Budget for the Supabase compute tier step (R-020) and PITR retention (R-116).
- Whether to move Vercel to a paid team plan instead of relying on preview suppression.
- Team size: the totals above assume two engineers; one engineer roughly doubles the calendar.
- Per-tenant AI budget defaults before billing goes live (R-110, R-111).

## Next actions

- Phase 1, S: confirm current Supabase plan, compute tier and PITR state in the dashboard (owner) and record it here.
- Phase 1, S: set `ai_monthly_budget_usd` explicitly in `system_config` so the cap is a deliberate number.
- Phase 5, M: add per-tenant usage metering (R-111) before pricing is published.
