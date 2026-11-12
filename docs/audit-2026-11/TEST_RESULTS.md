# Test results - audit 2026-11-12

Only results recorded in the audit working notes, the migration headers and the branch commits are listed.
Nothing here was re-run to write this document. Section 4 lists what was NOT run.
Status words: see [SECURITY_AUDIT.md](SECURITY_AUDIT.md).

## 1. Database fixes: verification by rolled-back impersonation

Each row is the VERIFY block recorded in the migration file. All ran on the live project inside transactions
that were rolled back, one identity per transaction.

| Migration | Finding | Recorded result |
|---|---|---|
| 20261112140000 | RLS-3, RLS-4, RLS-5 | Other-org Manager: asset upload 1,236 -> 0, report log 192 -> 0, system logs 273 -> 0, events 81 -> 30 own, workflow definitions 25 -> 0; three cross-tenant updates 0 rows; null-org log insert 42501. Company A control unchanged. Audit trigger back to enabled. |
| 20261112141000 | RLS-1, AUTH-3 | Driver: six access columns 42501 each, tyre count stays 2,249; name, language, push token, avatar still editable; username equal to another employee id refused; super admin and admin RPC paths work. |
| 20261112142000 | RLS-2 | KSA Manager: undo of a UAE/Egypt batch 42501, recount 0 (was 28); KSA control batch works; super admin works. |
| 20261112143000 | RLS-6 | Driver: forged approved insert 42501; sign-off column edits 42501; plain insert and field edit work; supervisor and incharge sign through the RPC; approved row cannot be edited. |
| 20261112144000 | AUTH-2 | Locked account: 0 rows on all 25 tables (own profile row still 1); four active identities identical before and after. |
| 20261112150000 | CON-1 | Driver: 42501, counts unchanged. Super admin: row written. |
| 20261112151000 | AI-1 | Driver inserts 42501; month spend unchanged; service role accepted; negative cost 23514. |
| 20261112152000 | FILE-2, FILE-3, RLS-12 | Locked account upload 42501; active users accepted; Driver / Tyre Man / Fleet Supervisor update vehicle photos 0 rows; Manager and super admin 1 row. Metadata rows only. The delete-policy statement was NOT applied. |
| 20261112153000 | FILE-1 | Driver and Tyre Man: 0 import files, 0 accident documents, 5 accident photos, inspection photos unchanged. KSA Manager 26 import files. Super admin 29. |
| 20261112154000 | RLS-10 | Driver updates 0 action items and 2 own odometer rows (was 161 and 2,416); capability holders unchanged. |
| 20261112155000 | RLS-6 | Edit at pending-incharge 42501; reject and resubmit path works; approve works. |
| 20261112156000 | API-6 | NOT RUN. Apply returned success; the runtime VERIFY block was never executed. |
| 20261112157000 | API-10, RLS-13 | As anon: all allowlisted RPCs answer as before; generator and direct `nextval` 42501. Manager still gets a number. Sequence USAGE: authenticated 44, anon 0. |
| 20261112160000 | AUTH-1 | Same super admin: aal1 -> not super admin; aal2 -> super admin. Header says "verified"; no count table recorded. |
| 20261112170000 | RLS-9 | Driver: directory 768 rows, private rows 0, real email via RPC 0 (was 4). Manager: private 768. Other-org Manager: 1. Locked account: 0. |
| 20261112180000 | RLS-7 | No-site Driver: 0 sited rows on all 11 tables; all-site identities identical before and after; one-site Driver sees 0 rows from another site. |
| 20261112181000 | RLS-10 | Driver updates only own 50 readings; Tyre Man 0; Fleet Supervisor and Manager 3,820. |
| 20261112182000 | RLS-11, CON-6 | Config rows: Driver 36, Manager 41, locked 0, super admin 62; console stats 42501 for non-super. |
| 20261112183000 | AUTH-6 | Recovery contact self-write 42501 under both claim styles; service path allowed; unrelated self edit works. |
| 20261112184000 | CON-2, API-12 | Three non-Sentry addresses refused (22023); two Sentry hosts accepted; four actions each write a server audit row; refusals write none. |
| 20261112185000 | AUTH-11 | Live definition carries the allowlist; eight sample inputs map as expected. No auth user was created. |

Pending, not applied, proven by rolled-back impersonation per its own header:
`pending_migrations/20261112171000_profiles_secret_columns_not_selectable.sql`.

## 2. Audit probes (before fixes)

| Area | Recorded result |
|---|---|
| RLS read sweep | 484 public tables per identity; 0 tables with RLS off; 0 anon table grants |
| Cross-country and cross-org direct writes | All refused (42501) for the tested Managers |
| Console RPC gate | 38 of 42 refused a Manager; none executable by anon |
| Secrets scan | 20 secret families over 2,766 commits: one finding (SEC-1) |
| `keytool` on the leaked keystore blob | Opens with the historical password: private key entry |
| Security advisors | 0 ERROR |
| Cron | 27 jobs, 0 failed runs in about 12,000 sampled |
| Backups | 30 nightly snapshots, no failures; 2 restore tests passed (1 table, 36 rows each) |

## 3. Automated and tool runs recorded

| Run | Result |
|---|---|
| `npm audit --omit=dev` | root 0, marketing 0, report engine 0; `mobile/` 4 high, 16 moderate, 1 low |
| `rowCapGuard.test.js` + `realtimeSubscriptionCost.test.js` | 12 of 12 pass |
| `npx vite build` (app) | Completed; eager graph 546 kB gzip, 962 chunks, 0 source maps |
| Marketing production build | Clean; 24 static pages, 1 dynamic route |
| Marketing crawl (16 routes, 5 widths) | 0 horizontal overflow, 0 broken internal links, 0 console errors |
| Marketing contrast scan | 0 failures across 4,142 text nodes (computed style) |
| Lighthouse 12.8.2, mobile, localhost | Performance 84 to 96; Accessibility 96 to 97; Best Practices 100; SEO 100. Lab only |
| Contact API, local | 403, 415, 400, 413, 429, 405, 503 as designed; honeypot 200. No email sent |
| Root SBOM | CycloneDX 1.5, 130 production components |
| Send-email deployed versus repo | Function file identical; bundled shared module older |

## 4. NOT run or no result recorded

| Item | Note |
|---|---|
| Full web test suite (`vitest`) on the fix branch | No run result recorded |
| Tests added on the branch | `edgeFunctionGuards.test.js`, `exportSafeScan.test.js`, `profileDirectory.api.test.js`, changes to `workOrdersPaging.test.js`, `marketing/test/contact.test.mjs`: added or changed; pass / fail not recorded |
| Web lint and build on the fix branch | Not recorded |
| Flutter analyze, tests, build | Commit 9ccb0656 states it was not compiled locally (no SDK). Commit 50b17fa6 is titled as a CI fix; the CI result after it is not recorded. Tests added: `mfa_gate_test.dart`, `mfa_gate_controller_test.dart`, handover tests |
| Edge function type check or tests | No `deno check`, no function tests exist |
| Edge function deploy and post-deploy check | Not deployed |
| API-6 lockout verification | Not run |
| Live HTTP: status codes, CORS, headers | Blocked from the audit host |
| End-to-end browser tests (Playwright script exists) | Not run |
| Mobile on a device (Flutter, Expo) | Not run |
| Marketing on real devices, Safari, screen readers | Not run |
| Field Core Web Vitals | Not available |
| Load or concurrency tests (AI budget lock, photo worker, rate limiters) | Not run |
| Full-history secret scan (unshallowed) | Not run |
| Python and Flutter dependency audit | Not run |
| Brute-force, timing or abuse tests against live endpoints | Not performed (read-only audit) |
| Storage object download and upload | Not performed; metadata rows only |
| Restore test beyond one small table | Not run |
| A plain Admin account; an account narrowed to real sites | No such account exists |
