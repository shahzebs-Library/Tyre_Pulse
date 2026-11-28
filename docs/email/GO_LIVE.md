# Email go-live (accidents, workshop, morning summary)

Status 2026-11-28: built and tested, **not applied, not deployed, not live.**
Everything below sends through the one email outbox (`email_outbox`, verified
addresses only, branded template). Until the last step the system only
*renders* each email and records it as `dry_run`; nothing reaches an inbox.

## What each email says (English; Arabic is rendered from the same template)

| Email | Subject | Body (3 lines) | Who gets it |
|---|---|---|---|
| Accident reported | `New accident ACC-2026-0148 at NHC` | A new accident was reported. Vehicle TM514 was in an accident; please review the case and take the first step. Reference, vehicle, site, severity, stage, date (driver and description for staff only). | The accident mailbox set in Settings (today: 1 address, copied from the current accident mail setting), plus the people your accident notify rules name for "accident reported" (step owners, Managers, Directors in that country/site), plus anyone added in Settings -> Email & alerts. Instant. |
| Accident step assigned | `Accident ACC-2026-0148: a step is assigned to you` | You own work on accident ACC-2026-0148. Vehicle TM514 at NHC; please open the case and complete your step. Lists every open step you hold on that case (for example Workshop assessment, Repair). | The person who now owns the step, or every real person holding the step's role in that country/site. One email per person per case per minute, so a new case that hands you three steps sends one email. Instant. |
| Vehicles waiting at the workshop | `3 vehicles are waiting for you to confirm` | Vehicles are waiting at your workshop. These vehicles were sent to your workshop and need you to confirm them in Tyre Pulse. Lists the vehicles. | The supervisor each vehicle is routed to by workshop intake. First email at once, then at most one every 30 minutes, always with that person's whole waiting count (never one email per vehicle). |
| Morning summary | `Tyre Pulse summary for 27 Nov 2026` | Your morning summary. What happened yesterday at your sites, and what is waiting now. Inspections done, accidents reported, vehicles into and released from the workshop (yesterday, Riyadh day), tyres needing attention and approvals waiting (now). | Admin, Manager and Director (editable in Settings), each with numbers for their own countries/sites. 07:00 Riyadh. A number that could not be read says "Could not be read", never 0. People can turn this one off for themselves. |

Previews (HTML, text and PNG, EN and AR): `docs/notifications/previews/`
(`accident_reported`, `accident_step_assigned`, `workshop_waiting`, `summary_daily`).

## How many people can receive email today (live, read 2026-11-28)

- Active users: **775**. With a verified real email address: **4** (2 Admin, 1 Reporter, 1 Inspector).
  Everyone else signs in with a phone-style login that has no mailbox; they keep getting the
  in-app bell and phone push exactly as now.
- Morning summary: **2** people would receive it today (the two Admins). No Manager or Director has a verified address yet.
- Accident step owners: 5 named owners, **1** has a verified address.
- Workshop supervisors routed to so far: 0 (no intake vehicles waiting yet).
- Accident mailbox: 1 external address configured and switched on.
- Personal email opt-outs: 0. Outbox today: 0 rows, mode `dry_run`.

**To reach more people:** each Manager / Director / supervisor adds and verifies a personal
email under Security & account (the "recovery email"). No code change is needed; they start
receiving email from the next event.

## Go-live steps (owner approves each)

1. **Apply the two migrations** in this order:
   `20261128140000_email_event_settings.sql` (settings page + accident email through the outbox),
   then `20261128141000_email_live_events.sql` (step-assigned, workshop waiting, morning summary,
   and the three schedules). Mode stays `dry_run`; from this moment emails are queued and
   rendered but not sent. Check after a day:
   `select event_key, status, count(*) from email_outbox group by 1, 2;`
2. **Deploy two edge functions** (both changed or new):
   - `email-dispatch` (redeploy; the shared templates gained the three new emails and the
     "Could not be read" wording). verify_jwt = false, as now.
   - `resend-webhook` (new; marks bounced and complained addresses so they are not mailed again).
     Needs the Resend webhook signing secret set as `RESEND_WEBHOOK_SECRET`.
   Make sure `RESEND_API_KEY` and the sender settings are set on the project (they already
   are for the old `send-email`).
3. **Send yourself a test** from Settings -> Email & alerts -> "Send me a test email" and look at it
   in the `email_outbox` (`status = dry_run`).
4. **Switch on sending:**
   `update system_config set value = 'live' where key = 'email_dispatch_mode';`
   To stop again at any time: set it back to `dry_run` (queued rows wait, nothing is lost).

## Owner decisions

- The accident "reported" email follows your accident notify rules (step owners, Managers,
  Directors). Admins get it only if they own a step or are added in Settings. Add them in
  Settings -> Email & alerts if you want every Admin told.
- Workshop waiting batches at 30 minutes after the first email. Shorter means more emails
  during a big ERP upload.
- Morning summary goes to Admin, Manager and Director by default; change the roles in Settings.
- The summary uses the app's own visibility rules: a Manager with no country or site set sees
  zeros for rows that have a country/site. Set people's countries and sites in Users.
