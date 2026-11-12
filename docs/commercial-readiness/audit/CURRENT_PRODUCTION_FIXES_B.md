# Current production fixes, batch B

Date: 2026-11-12. Scope: four confirmed problems in the live system (scheduled report money, outbound
webhooks, the privacy page, backups and monitoring). Production was read only: SELECT statements through the
Supabase connector, nothing applied, nothing deployed, no cron change, no delivery triggered.

Words used: CONFIRMED means observed by a read-only query or by reading the live function body today.
INFERRED means reasoned from code. UNVERIFIED means it could not be checked from here.

## What changed in the repository

| File | Change |
|---|---|
| `supabase/functions/send-scheduled-reports/index.ts` | money per country and per currency in the executive, claims and dataset e-mails; expense grid as the tyre spend source |
| `supabase/functions/send-scheduled-reports/money.ts` | NEW pure, testable money helpers (no blending by construction) |
| `supabase/pending_migrations/20261113140000_ops_report_exec_money_by_country.sql` | DRAFT: per-country money aggregate for the e-mail |
| `supabase/pending_migrations/20261113141000_ops_webhook_reliable_delivery.sql` | DRAFT: reliable webhook worker, dead-letter, signing, scoping, failure reporting |
| `supabase/pending_migrations/20261113142000_ops_backup_coverage_restore_test_health.sql` | DRAFT: wider snapshots, full restore test, health answer for an uptime monitor |
| `src/lib/api/integrations.js` | `sendWebhookTest`, `retryWebhookDelivery`, plain-English reasons (inert until the draft is applied) |
| `src/lib/privacyProcessors.js` | NEW: the one list of outside companies that receive data |
| `src/pages/Privacy.jsx`, `src/pages/DataDeletion.jsx` | corrected text |
| `docs/runbooks/BACKUP_AND_RESTORE_STATUS.md` | NEW: facts, gaps, tested restore procedure, monitoring proposal |
| Tests | `src/test/scheduledReportMoney.test.js` (29), `src/test/privacyProcessors.test.js` (9), `src/test/integrations.api.test.js` (+5), `supabase/tests/ops_report_exec_money.test.mjs` (9), `supabase/tests/ops_webhook_delivery.test.mjs` (16), `supabase/tests/ops_backup_health.test.mjs` (7) |

Verification run: eslint on the changed web files (clean), 18 related vitest files 218 tests passed, the three
PGlite suites 32 tests passed, `npx vite build` clean, a strict TypeScript check of the edge function with
stubbed Deno imports (clean). The full vitest suite was not run, as instructed.

Note: `audit/checklist-report-review/*.pdf` show as modified in the working tree with a timestamp that does not
match any of my test runs. Another session's test run rewrote them (a known side effect of
`reportCorrections.test.js`). I did not touch or revert them.

---

## 1. Scheduled executive e-mail adds SAR + AED + EGP and uses the wrong cost source (MODC-05)

**Root cause. CONFIRMED.**
1. The live function `report_exec_digest(p_org, p_days)` computes spend as
   `sum(cost_per_tyre * qty)` over `tyre_records` with only an organisation filter. Every country lands in one
   number (`all.spend`, `win.spend`, `top_brands`, `top_sites`, `worst_assets`, `by_category`, `monthly_trend`,
   `projected_annual_spend`). `wo_cost`, `accident_cost` and `monthly_budget` are blended the same way.
2. The edge function read ONE label from `system_config.default_currency` (value `SAR`) and printed it in front
   of every amount (`systemCurrency`, then `money(n, currency)` at 33 call sites).
3. The screens use a different source: the expense grid, `parts_consumption.tyre_cost`, per country.

Measured today (read only), current company:

| Country | Expense grid tyre cost (what the screens show) | Tyre record prices (what the e-mail used) |
|---|---|---|
| KSA | SAR 12,367,362 | 4,270,910 |
| UAE | AED 4,006,505 | 425,868 |
| Egypt | EGP 16,517,335 | 5,949,557 |
| What the e-mail printed | | "SAR 10,646,335" (the three added together) |

The same blending existed in the claims e-mail (`claim_total` and the rest summed over all countries) and in
every dataset e-mail with a money column (cost, KPI, accidents, vendor, PM, workshop: `moneySum`).

**Affected files.** `supabase/functions/send-scheduled-reports/index.ts`; live function `report_exec_digest`.

**Impact on current users.** Low today, real the moment it is used: 7 schedules exist, 1 is active (an
inspection summary, no money). The only executive schedule is inactive. "Send now" on the executive, cost, KPI,
accident or claims schedule would send the wrong figure to management.

**Fix (repo source only, not deployed).**
- New module `money.ts`: money always travels with its currency; there is no function that adds two currencies;
  a single total exists only when everything in scope is one currency; a country with no known currency prints
  with no code and is never merged.
- Executive e-mail: counts still come from `report_exec_digest`. Money comes from the new aggregate
  `report_exec_money_by_country` (draft migration `20261113140000`): expense grid tyre cost, work order cost,
  accident cost and tyre budget, one block per country in its own currency, with a "Money by country" table,
  per-country six month trend, twelve month spend against budget, top sites and top assets. Headline tiles show
  "SAR x | AED y | EGP z", never one number, and say "per currency, not added together". The legacy blended
  lists (top brands by spend, spend by category, spend by country, projected annual spend) are no longer
  rendered. Cost per km is shown only for a single-country organisation, and now with three decimals (it was
  rounded to a whole number, so it always printed 0).
- Works in either order: if the new aggregate is not installed, the e-mail falls back to a per-country list
  built from the old digest (still never blended, labelled "tyre record prices", other money N/A).
- Claims and dataset e-mails: each row's currency comes from its own country (`country_currency` table); totals
  are per currency; recovery rate and average claim are shown only inside one currency; each row in the recent
  list carries its own currency.
- Read-only check of the new aggregate's query against production returned exactly the screen figures above,
  plus work order cost SAR 35,060,742 (KSA only) and accident cost SAR 38,920.

**Automated tests.** `src/test/scheduledReportMoney.test.js` (29 tests: lookup, per-currency sums, the real
figures above never produce 32,891,202 or 10,646,335, fallback, budget per country, broken payload gives no
figures, source scan that no renderer takes one global currency and that both files have no backslash-u
escapes). `supabase/tests/ops_report_exec_money.test.mjs` (9 tests on PGlite: one element per country, expense
grid source, windows, blank currency resolved from the country, other organisation never leaks, null
organisation returns nothing, service role only).

**Regression risk.** Medium for the e-mail layout (the executive e-mail is restructured; it was rendered only
through type checks and unit tests here, not in a mail client). None for the web app. Figures in the e-mail
change on purpose; tell recipients before the first send.

**Not fixed, stated.** Send times are still computed in Riyadh time for every organisation (part of MODC-05).
The window is anchored on the organisation's newest expense date, so a country whose uploads stopped (UAE and
Egypt: last expense line August 2026) shows 0 for "last 30 days". That is true, and the table shows it per
country, but it may surprise a reader.

**Needs the owner.**
1. Apply draft `20261113140000` (one new function, service role only, no table change).
2. Deploy `send-scheduled-reports`. It is now TWO files (`index.ts` and `money.ts`), so deploy with the Supabase
   CLI from the repo (`supabase functions deploy send-scheduled-reports`, same verify setting as the version
   live now), not by pasting one file. Then press "Send now" on one schedule and read the e-mail.

---

## 2. Outbound webhooks have never delivered (MODC-74)

**What exists. CONFIRMED.** Tables `webhook_subscriptions` (2 rows) and `webhook_deliveries` (12 rows).
Queueing: `consume_event_webhooks(domain_events)`, registered and enabled in `event_consumers`. Delivery is
NOT an edge function: it is the SQL function `deliver_pending_webhooks()` using `pg_net`, run by cron job 5
`deliver-webhooks` every minute (10,079 successful runs in 7 days, 0 failed). A second registry,
`webhook_endpoints` (Developer Portal), has 0 rows and nothing reads it for delivery (MODC-75, not changed).

**Exact reason nothing was delivered. CONFIRMED.**
1. Both subscriptions (created 2026-07-09 and 2026-07-11, both in the current company) point at the root of
   this product's own website: the host contains "tyrepulse" and the address has no path. A static website
   answers a POST with HTTP 405. All 44 attempts recorded `response_status = 405`, `last_error = "HTTP 405"`.
   They were test entries; no customer receiver has ever been registered.
2. After 20 consecutive failures each subscription was switched off automatically
   (`disabled_reason = "Auto-disabled after 20 consecutive failures"`, counters 20 and 24). Nothing told anyone:
   the worker writes no log row and sends no notice.
3. The worker only sends rows whose subscription is active and has no rule for rows that can no longer be sent.
   So 9 rows (7 from 2026-07-10, 2 from 2026-07-14) have been `pending` ever since, and 3 rows that reached 6
   attempts are `failed`. That is the "9 pending, 3 failed, 0 delivered".

So the engine did send; the receivers refused. The real defects are: no dead-letter rule, no reporting, and no
way to prove an endpoint before depending on it.

**Further defects found by reading the worker. INFERRED from the live body.**
a. A response row already purged by `pg_net` (it keeps about 6 hours; oldest row today is 6 hours old) leaves a
   delivery in flight for ever (`IF NOT FOUND THEN CONTINUE`).
b. If `net.http_post` raises for one row, the whole run aborts and every company's deliveries stop.
c. The signature covers the body only, so a captured request can be replayed later.
d. The only address rule is "starts with https://"; localhost, private and metadata addresses are accepted.
e. One global `LIMIT 50` by time: a company with a backlog delays all others.
f. A delivery whose organisation differs from its subscription's is sent anyway.

**Fix (draft migration `20261113141000`, not applied; nothing was sent).**
- Dead-letter: status `failed` is the dead-letter state (the page and the console already show it), now always
  with `dead_at` and `dead_reason`. A pending row that could not be sent for 72 hours expires into it.
- Retries with backoff: 2, 4, 8, 16, 32, 60, 60 minutes plus up to 20 percent jitter, `max_attempts` 8 per row
  (about three hours). A timeout, or no recorded response after 15 minutes, counts as a failed attempt. HTTP 410
  is final at once and switches the webhook off.
- Attempt count and last error: `attempts`, `last_attempt_at`, `last_error`, `response_status` per row.
- Signed payloads: existing `X-TyrePulse-Signature` kept; added `X-TyrePulse-Signature-V2: t=<unix>,v1=<hex>`
  (HMAC-SHA256 of `<t>.<raw body>` with the webhook secret), plus `X-TyrePulse-Delivery`, `X-TyrePulse-Attempt`,
  `X-TyrePulse-Timestamp`. Receivers should verify V2, reject a timestamp older than five minutes and ignore a
  delivery id they have already processed.
- Per-organisation scoping: a row is sent only when its organisation equals its webhook's; at most 20 per
  organisation and 100 per run; each send in its own guarded block.
- Failure reporting: every dead-letter, expiry and auto-disable writes to `system_logs` (module `integrations`,
  source `webhooks`, organisation stamped, no address and no secret), at most one per webhook and kind per hour.
- Safe addresses: `webhook_url_is_safe()` enforced on save and at send (https only, no credentials, no
  localhost, private, link-local, metadata, `.local`, `.internal`). Limit: it cannot resolve names, so a public
  name that points to a private address is not caught.
- Re-enabling a webhook clears its failure counter.
- `webhook_send_test(id)` and `webhook_retry_delivery(id)` for the company's own Admin, Manager or Director
  (own organisation only). A test is one attempt, one per minute. This would have shown the 405 in July within a
  minute. Web service functions `sendWebhookTest` and `retryWebhookDelivery` are in
  `src/lib/api/integrations.js`; they answer "not switched on yet" until the draft is applied.

**Effect on the current company when applied.** First run: the 9 stranded rows become `failed` with the reason
"Not delivered within 72 hours because the webhook was switched off", and one warning per webhook appears in
`system_logs`. Nothing is sent (both webhooks are off). Nothing else changes.

**Automated tests.** `supabase/tests/ops_webhook_delivery.test.mjs`, 16 tests on PGlite with `pg_net` replaced
by a stub: address safety, signed send verified with Node's own HMAC against the exact body text, delivered on
2xx, backoff timing, dead-letter with reason and log row (no address or secret in the log), timeout, lost
response, 410, auto-disable at 20 and reset on re-enable, the July case (stranded rows expire, nothing sent),
organisation mismatch never sent, fairness (20 per organisation), one bad row does not stop the run, test and
retry RPCs scoped to the caller's organisation, report rate limit, grants. `src/test/integrations.api.test.js`
+5 tests for the two service functions.

**Regression risk.** Low: no active webhook exists. The worker keeps its name, cron job and return type; the
return value gains two keys (`retrying`, `expired`).

**Not done, stated.**
- The Integrations page has no "Send test" and "Retry" buttons yet (the page was outside my files). The service
  functions are ready; wiring is two buttons.
- `DELIVERY_COLS` in the web service was NOT extended with `dead_reason`: selecting a column that does not exist
  yet fails the whole request, so add it in the same change that applies the migration.
- Whether `pg_net` signs exactly `payload::text` was checked against the stub only (INFERRED from pg_net's
  source: it sends `body::text`). The owner's one real test send (below) settles it.
- No purge of old delivered rows (a purge function contains a delete, which needs the owner present to apply).
- The Developer Portal registry (`webhook_endpoints`, MODC-75) still delivers nothing. Retire it or point it at
  `webhook_subscriptions`; owner decision.

**Needs the owner.** Apply draft `20261113141000` (the text contains the words "drop" and "delete" in comments,
so the connector will ask for confirmation). Then, as the one real delivery: create a webhook to a receiver you
control, press Send test (or call `webhook_send_test`), confirm HTTP 200 and that the V2 signature verifies.

**Previous worker (for rollback).** The live body of `public.deliver_pending_webhooks()` before this change:

```sql
CREATE OR REPLACE FUNCTION public.deliver_pending_webhooks()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  d record; r record; v_body text; v_sig text; v_req bigint;
  n_sent int := 0; n_done int := 0; n_dead int := 0;
BEGIN
  FOR d IN
    SELECT wd.id, wd.subscription_id, wd.attempts, wd.request_id
      FROM public.webhook_deliveries wd
     WHERE wd.status = 'pending' AND wd.request_id IS NOT NULL
  LOOP
    SELECT status_code, error_msg INTO r FROM net._http_response WHERE id = d.request_id;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF r.status_code BETWEEN 200 AND 299 THEN
      UPDATE public.webhook_deliveries
         SET status = 'delivered', delivered_at = now(),
             response_status = r.status_code, last_error = NULL, request_id = NULL
       WHERE id = d.id;
      UPDATE public.webhook_subscriptions
         SET last_success_at = now(), consecutive_failures = 0
       WHERE id = d.subscription_id;
      n_done := n_done + 1;
    ELSE
      UPDATE public.webhook_deliveries
         SET response_status = r.status_code,
             last_error = left(COALESCE(r.error_msg, 'HTTP ' || COALESCE(r.status_code::text, '?')), 500),
             request_id = NULL,
             status = CASE WHEN d.attempts >= 6 THEN 'failed' ELSE 'pending' END
       WHERE id = d.id;
      UPDATE public.webhook_subscriptions s
         SET last_failure_at = now(),
             consecutive_failures = s.consecutive_failures + 1,
             active = CASE WHEN s.consecutive_failures + 1 >= 20 THEN false ELSE s.active END,
             disabled_reason = CASE WHEN s.consecutive_failures + 1 >= 20
                                    THEN 'Auto-disabled after 20 consecutive failures' END
       WHERE id = d.subscription_id;
      IF d.attempts >= 6 THEN n_dead := n_dead + 1; END IF;
    END IF;
  END LOOP;
  FOR d IN
    SELECT wd.id, wd.payload, wd.attempts, s.url, s.secret, wd.event_type
      FROM public.webhook_deliveries wd
      JOIN public.webhook_subscriptions s ON s.id = wd.subscription_id
     WHERE wd.status = 'pending' AND wd.request_id IS NULL
       AND wd.next_attempt_at <= now() AND wd.attempts < 6 AND s.active
     ORDER BY wd.next_attempt_at
     LIMIT 50
     FOR UPDATE OF wd SKIP LOCKED
  LOOP
    v_body := d.payload::text;
    v_sig  := 'sha256=' || encode(hmac(v_body, d.secret, 'sha256'), 'hex');
    v_req := net.http_post(
      url     := d.url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'User-Agent', 'TyrePulse-Webhooks/1.0',
        'X-TyrePulse-Event', d.event_type,
        'X-TyrePulse-Signature', v_sig),
      body    := d.payload,
      timeout_milliseconds := 10000
    );
    UPDATE public.webhook_deliveries
       SET attempts = d.attempts + 1, request_id = v_req,
           next_attempt_at = now() + make_interval(mins => least(power(2, d.attempts + 1)::int, 60))
     WHERE id = d.id;
    n_sent := n_sent + 1;
  END LOOP;
  RETURN jsonb_build_object('sent', n_sent, 'delivered', n_done, 'dead', n_dead);
END;
$function$;
```

---

## 3. The privacy page was wrong (AI-7)

**Root cause. CONFIRMED.** `src/pages/Privacy.jsx` stated "The only data shared with a third party is crash and
performance diagnostics, sent to our error-monitoring provider (Sentry)". The page was written in July for the
store listing and never updated as features were added.

**What the code really does (each one checked in the code today).**

| Company | Checked where | What is sent |
|---|---|---|
| Supabase | all data access | everything stored (hosting) |
| Vercel | web hosting | IP and browser details when pages load |
| Anthropic | `ai-tyre-inspection/index.ts` (photo as base64 plus a fixed instruction), `chat-ai/index.ts`, `ai-orchestrator/index.ts` (question and fleet figures) | tyre photos, assistant questions and the figures needed to answer |
| Google Gemini | `ai-tyre-inspection/index.ts`, only when a backup key is configured | the same photo and instruction |
| OpenAI | `embed-worker`, `generate-embedding`, `ai-orchestrator` (search query) | knowledge document text and search questions, no photos |
| Sentry | `src/lib/monitoring.js`, mobile and Flutter packages | errors, performance sample, user ID, role, site, masked screen recording on error (web) |
| PostHog | `src/lib/analytics.js`, web only, only when a key is set | page and click events with text masked, user ID, role, site |
| Resend | `send-email`, `send-scheduled-reports`, `workflow-notify`, `account-recovery`, `sentry-crash-alert` | recipient address and e-mail content |
| Firebase Cloud Messaging and Expo push | `workflow-notify/index.ts` | push token, notification title and text |
| Twilio | `workflow-notify` (WhatsApp), `account-recovery` (SMS), only when configured | phone number and message text |
| Open-Meteo | `src/lib/api/weather.js`, called from the browser | coordinates of a city from a fixed list, and so the caller's IP |
| Google Fonts | `src/components/auth/login/loginStyles.js` | IP address when the sign-in page loads |
| Cloudflare Turnstile | `src/components/auth/TurnstileWidget.jsx`, inert unless a key is set | browser signals and IP |
| Stripe | `billing-checkout`, `billing-webhook`; 0 subscriptions, 0 invoices in production | not in use; later organisation reference, plan and price |

Three companies were not in the task's list and were found in the code: Twilio, Google Fonts and Cloudflare
Turnstile. Which optional ones are actually switched on in production (Gemini backup key, PostHog key, Twilio,
Turnstile) is UNVERIFIED: secrets and hosting settings cannot be read from here. The page therefore says
"only if switched on" for those. Usage seen in the data: Anthropic is in use (64 photo analyses and 5 assistant
calls in 90 days); the knowledge base holds 0 documents, so nothing has gone to OpenAI yet.

**Affected files.** `src/pages/Privacy.jsx`, `src/pages/DataDeletion.jsx`, new `src/lib/privacyProcessors.js`.

**Impact on current users.** The current company's staff were covered by an untrue statement. No data flow
changed; only the description is now true.

**Fix.** The page has a "Who receives your data" table driven by one list (`privacyProcessors.js`): company,
what it does and why, what it receives, and when (always, when the feature is used, only if switched on, not in
use yet). Added a plain paragraph on AI photo analysis (photos can show people and plates; results are
suggestions, not a certificate) and one on processing outside the user's country. "Data we collect" now includes
assistant questions and web usage information. The line saying e-mail addresses are never real was corrected
(some accounts have real addresses, used for sign-in, recovery and notices). The effective date is now
12 November 2026. The deletion page links to the list and says honestly that copies already sent to an outside
company (a photo sent for analysis, a delivered e-mail, a crash report) cannot be recalled.

**Automated test.** `src/test/privacyProcessors.test.js` (9 tests). The important one is a drift guard: it
scans every edge function and the web source for external https hosts and fails if any host is not covered by
the list (with a short, reasoned allowlist for import registries, our own domains, placeholders and links). It
also checks the scan is not vacuous, renders the page and checks every company appears, and checks the old
"only Sentry" sentence is gone.

**Regression risk.** None functional (text and one static table on two public pages).

**LEGAL REVIEW NEEDED.** This is a legal-facing page. The text is a factual engineering description, not legal
advice. Before relying on it the owner should have the wording reviewed, and in particular: the effective date;
whether a data processing agreement and a named sub-processor list are needed for customers; each provider's
own retention and training terms (UNVERIFIED here); international transfer wording for KSA, UAE and Egypt; the
deletion page's promise that diagnostics and photos "linked to your account" are deleted within 30 days (the
process behind that promise was not verified); and the store Data Safety declaration, which must now also list
photos sent to an AI provider.

**Needs the owner.** Review as above, then a normal web deploy (merge to main). Update the Play and App Store
data safety forms to match.

---

## 4. Backups, restore and monitoring

Full facts, gaps, the tested restore procedure and the monitoring proposal are in
`docs/runbooks/BACKUP_AND_RESTORE_STATUS.md`. Summary:

**CONFIRMED today.**
- Nightly snapshot ran every night for 30 days, 0 failures, longest run 19 seconds. It really captures 7 small
  tables (accidents 43, inspections 2,596, stock 36, tyre records 11,260, fleet 1,622, two empty PM tables).
  `work_orders` (96,944 rows) is skipped every night as too large.
- Not covered at all: the expense ledger (218,776 rows), job card lines (184,025), production (212,567), audit,
  users, about 20 small operational and setup tables, and every file in storage (27,287 files, 5.8 GB, of which
  tyre photos are 5.7 GB).
- Snapshots live inside the same database (456 MB). The 14 night retention was applied today and takes effect
  at tonight's run (30 snapshots still exist now). This answers the open question in REL-4.
- Restore tests: 2 rows, both 2026-11-11, both passed, both one table of 36 rows. The monthly job has not run
  yet (first run 2026-12-01) and tests only that one table.
- The job watchdog works and did raise an alarm for `due-alerts-scan` on 2026-10-25; the job kept failing until
  2026-11-08. The alarm is an in-app notice to super admins only, so nobody acted for 14 days.
- No outside uptime check and no status page.
- New evidence on platform backups: `archive_mode = on`, Supabase's WAL push as archive command, 2,176 change-log
  files archived since the restart on 2026-11-09, the last one a minute before the check, 0 failures. So the
  database IS continuously shipping to Supabase's archive.

**UNVERIFIED (owner must read the Supabase dashboard, Database, Backups).** The plan; whether daily backups are
listed and for how many days; whether point-in-time recovery is enabled and its retention; whether restore to a
new project is offered; and whether Storage files are covered by any backup (Supabase states database backups
do not include them). Steps are in section 4 of the runbook.

**Root cause of the gaps.** The in-app snapshot was built for small-table row recovery and was never meant as
disaster recovery; the large tables were excluded to protect a small instance; the restore test and the
watchdog were added later and report only inside the app.

**Impact on current users.** No current failure. The risk is silent: an accidental bulk delete on the expense
ledger or job cards, or the loss of photos, has no recovery path that anyone has confirmed.

**Fix drafted (not applied): `20261113142000`.**
1. 21 more small tables in the nightly snapshot (field work that cannot be re-imported, small cost ledgers,
   organisation and access setup). About 6 MB per night, about 85 MB at 14 nights (estimate).
2. The scheduled restore test rebuilds every captured table and writes a `critical` log row on failure.
3. `health_ping()`: a read-only answer for a free outside monitor. It is false when the last snapshot is older
   than 26 hours, when any scheduled job is in alarm, or when the latest restore test failed. No business data.
   It is callable without signing in on purpose; that adds one function to the reviewed anonymous list
   (14 today), which is an owner decision. Any repo test that pins that list must be updated in the same change.

**Automated test.** `supabase/tests/ops_backup_health.test.mjs`, 7 tests on PGlite: list contents, failure with
no snapshot, full pass, count mismatch reported as critical, a copy that can no longer be decoded fails only
that table, health false on stale snapshot and on an open alarm and leaks no job name, grants.

**Regression risk.** Low. The nightly job takes slightly longer; no business table is written.

**Needs the owner.** Read and record the dashboard facts; decide how photos are protected; approve the draft;
create a free outside monitor with three checks (web app, `health_ping`, one function) and point the in-app
status page at it; run one timed restore into a new project.

---

## Deploy and apply list (owner approval needed for each)

| Step | What | Order |
|---|---|---|
| A | Apply `20261113140000` (money aggregate) | before or after B, both orders are safe |
| B | Deploy edge function `send-scheduled-reports` (two files, by CLI) | then one "Send now" check |
| C | Apply `20261113141000` (webhooks) | then one real test send to a receiver you control |
| D | Web deploy (privacy page, deletion page, service functions) | after legal review of the wording |
| E | Apply `20261113142000` (snapshots, restore test, health) | then set up the outside monitor |
| F | Read the Supabase backup settings and record them in `DR_RUNBOOK.md` | any time, no risk |

Nothing in this batch was applied or deployed.

## Could not verify

- Platform backup plan, retention and point-in-time recovery; storage file backup.
- Which optional providers are configured in production (Gemini backup, PostHog, Twilio, Turnstile, Sentry web key).
- How the restructured executive e-mail looks in a real mail client.
- That `pg_net` sends byte for byte the text that is signed (tested against a stub only).
- Provider retention and model-training terms referenced by the privacy page.
