import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { EMAIL_STUBS, SEED_USERS, id, ORG_A, ORG_B } from './fixtures/email_stubs.mjs'

const read = f => readFile(new URL(`../migrations/${f}`, import.meta.url), 'utf8')
const MIGS = [
  await read('20261128110000_workflow_notify_true_delivery.sql'),
  await read('20261128111000_email_outbox.sql'),
  await read('20261128140000_email_event_settings.sql'),
]
const P3 = await read('20261128141000_email_live_events.sql')

const STUBS = `
  CREATE TABLE net._http_response(id bigint, status_code int, content text, error_msg text);
  CREATE TABLE public.organisations(id uuid primary key);
  INSERT INTO public.organisations VALUES ('${ORG_A}'),('${ORG_B}');
  CREATE TABLE public.domain_events(id bigint primary key, event_type text, entity_type text, entity_id text, organisation_id uuid,
    created_at timestamptz default now(), payload jsonb default '{}', actor_id uuid);
  CREATE TABLE public.accidents(id uuid primary key, organisation_id uuid, reference_no text, asset_no text, site text, country text, severity text,
    injuries boolean default false, workflow_stage text default 'reported', claim_status text, accident_type text, estimated_damage_cost numeric,
    final_amount numeric, repair_cost numeric, vor boolean default false, third_party_involved boolean default false, department text,
    incident_date date, driver_name text, description text, created_at timestamptz default now());
  CREATE TABLE public.accident_routing_rules(organisation_id uuid, active boolean, event_key text, match_severities text[], match_types text[],
    match_sites text[], match_countries text[], min_cost numeric, require_injury boolean default false, require_vor boolean default false,
    require_third_party boolean default false, departments text[], to_roles text[], cc_roles text[], escalate_roles text[]);
  CREATE TABLE public.notifications(id uuid default gen_random_uuid() primary key, user_id uuid, type text, title text, body text,
    entity_type text, entity_id uuid, read boolean default false, created_at timestamptz default now(), dedupe_key text unique);
  CREATE FUNCTION public._user_push_tokens(uuid) RETURNS SETOF text LANGUAGE sql AS $$ SELECT 'ExponentPushToken[x-' || $1 || ']' $$;
  CREATE FUNCTION public.accident_notify_configured(uuid, text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE FUNCTION public._accident_notify_targets(uuid, text, jsonb, uuid) RETURNS uuid[] LANGUAGE sql AS $$ SELECT '{}'::uuid[] $$;
  CREATE FUNCTION public._accident_is_test_profile(p uuid) RETURNS boolean LANGUAGE sql AS $$
    SELECT coalesce((SELECT full_name ~* '^(test|demo)' FROM public.profiles WHERE id = p), false) $$;
  CREATE FUNCTION public.accident_severity_label(text) RETURNS text LANGUAGE sql AS $$ SELECT initcap($1) $$;
  CREATE FUNCTION public.accident_stage_label(text) RETURNS text LANGUAGE sql AS $$ SELECT initcap($1) $$;
  CREATE FUNCTION public.accident_pending_action(text) RETURNS text LANGUAGE sql AS $$ SELECT 'Review' $$;
  CREATE FUNCTION public.accident_notify_dedupe_key(text, text, uuid, text, timestamptz) RETURNS text LANGUAGE sql AS $$ SELECT $1||$2||$3 $$;
  CREATE FUNCTION public.accident_mail_config(p uuid) RETURNS TABLE(source text, emails_enabled text, email_to text, email_cc text, subject_prefix text)
    LANGUAGE sql AS $$ SELECT 'none'::text, 'false'::text, null::text, null::text, null::text $$;

  CREATE TABLE public.event_consumers(consumer text primary key, event_types text[], enabled boolean, description text, created_at timestamptz default now());
  CREATE TABLE public.accident_case_workstreams(id uuid primary key, accident_id uuid, workstream_key text, status text default 'assigned',
    owner_id uuid, owner_role text);
  CREATE FUNCTION public.accident_people_for(p_org uuid, p_roles text[], p_users uuid[], p_country text, p_site text) RETURNS SETOF uuid
    LANGUAGE sql AS $$ SELECT p.id FROM public.profiles p WHERE p.organisation_id = p_org AND not coalesce(p.locked,false)
      AND (p.role = any(p_roles) OR p.id = any(p_users)) $$;

  CREATE TABLE public.workshop_status_records(id uuid default gen_random_uuid() primary key, organisation_id uuid, country text, site text,
    asset_no text, current_active boolean default true, deleted_at timestamptz, confirm_status text, routed_to uuid[] default '{}',
    routed_at timestamptz, submitted_at timestamptz, created_at timestamptz default now(), first_seen_at timestamptz, removed_at timestamptz);
  CREATE TABLE public.test_notices(org uuid, usr uuid, title text);
  CREATE FUNCTION public.workshop_status_notice_send(p_org uuid, p_user uuid, p_kind text, p_title text, p_body text,
    p_entity_type text, p_entity_id uuid, p_link text) RETURNS boolean LANGUAGE sql AS $$
    INSERT INTO public.test_notices VALUES (p_org, p_user, p_title) RETURNING true $$;
  CREATE FUNCTION public.workshop_status_asset_list(text[]) RETURNS text LANGUAGE sql AS $$ SELECT array_to_string($1, ', ') $$;

  CREATE TABLE public.inspections(id uuid default gen_random_uuid() primary key, organisation_id uuid, country text, site text,
    status text, approval_status text, inspection_date date, completed_date date);
  CREATE TABLE public.checklist_submissions(id uuid default gen_random_uuid() primary key, organisation_id uuid, country text, site text,
    approval_status text);
  CREATE TABLE public.due_alert_rules(rule_key text primary key, lead_days int, lookback_days int);
  INSERT INTO public.due_alert_rules VALUES ('tyre_end_of_life', 0, null);
  CREATE TABLE public.test_due(org uuid, country text, site text);
  CREATE TABLE public.test_flags(name text primary key);
  CREATE FUNCTION public._due_items(p_rule text, p_lead int, p_lookback int)
    RETURNS TABLE(entity_key text, org uuid, country text, site text, label text, stage text) LANGUAGE plpgsql AS $$
    BEGIN
      IF exists (SELECT 1 FROM public.test_flags WHERE name = 'due_broken') THEN RAISE EXCEPTION 'boom'; END IF;
      RETURN QUERY SELECT 'k'::text, d.org, d.country, d.site, 'tyre'::text, 'due'::text FROM public.test_due d;
    END $$;

  CREATE TABLE cron.job(jobid serial, jobname text unique, schedule text, command text);
  CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $$
    INSERT INTO cron.job(jobname, schedule, command) VALUES (n, s, c) RETURNING jobid::bigint $$;
`

async function withDb(fn) {
  const db = new PGlite()
  try {
    await db.exec(EMAIL_STUBS + SEED_USERS + STUBS + MIGS.join('\n') + P3)
    await fn(db)
  } finally { await db.close() }
}
const outbox = (db, ev) => db.query(`SELECT to_address, template_key, data, dedupe_key, entity_type, entity_id FROM email_outbox WHERE event_key=$1 ORDER BY to_address`, [ev]).then(r => r.rows)

test('accident step assigned: the named owner gets one email listing all their open steps; replay adds nothing', async () => {
  await withDb(async db => {
    await db.exec(`
      INSERT INTO accidents(id, organisation_id, reference_no, asset_no, site, country, severity) VALUES ('${id(60)}','${ORG_A}','ACC-9','TM514','NHC','KSA','minor');
      INSERT INTO accident_case_workstreams VALUES
        ('${id(61)}','${id(60)}','assessment','assigned','${id(5)}',null),
        ('${id(62)}','${id(60)}','finance','assigned','${id(5)}',null),
        ('${id(63)}','${id(60)}','repair','completed','${id(5)}',null);
      INSERT INTO domain_events(id, event_type, entity_type, entity_id, organisation_id, actor_id, created_at) VALUES
        (21,'accident.workstream_assigned','accident_case_workstream','${id(61)}','${ORG_A}','${id(1)}', '2026-11-28 10:00:05+00'),
        (22,'accident.workstream_assigned','accident_case_workstream','${id(62)}','${ORG_A}','${id(1)}', '2026-11-28 10:00:05+00');`)
    for (const e of [21, 22, 21]) await db.query(`SELECT consume_event_email_accident_step(d) FROM domain_events d WHERE id=$1`, [e])
    const rows = await outbox(db, 'accident.step_assigned')
    assert.equal(rows.length, 1, 'one email for two steps in the same minute, none on replay')
    assert.equal(rows[0].to_address, 'sara@example.com')
    assert.deepEqual(rows[0].data.steps, ['assessment', 'finance'], 'completed step not listed')
    assert.equal(rows[0].entity_type, 'accident')
    assert.equal(rows[0].entity_id, id(60))
    const reg = (await db.query(`SELECT event_types FROM event_consumers WHERE consumer='consume_event_email_accident_step'`)).rows[0]
    assert.deepEqual(reg.event_types, ['accident.workstream_assigned'])
  })
})

test('accident step: role-owned step mails real role holders; synthetic, actor and test profiles are skipped; type can be turned off', async () => {
  await withDb(async db => {
    await db.exec(`
      INSERT INTO auth.users VALUES ('${id(7)}','test.user@example.com', now()), ('${id(8)}','unverified@example.com', null);
      INSERT INTO profiles(id, username, full_name, role, organisation_id, org_id) VALUES
        ('${id(7)}','tst','Test User','Manager','${ORG_A}','${ORG_A}'),
        ('${id(8)}','unv','Unverified Eight','Manager','${ORG_A}','${ORG_A}');
      INSERT INTO accidents(id, organisation_id, reference_no, site) VALUES ('${id(70)}','${ORG_A}','ACC-10','NHC');
      INSERT INTO accident_case_workstreams VALUES ('${id(71)}','${id(70)}','liability','assigned',null,'Manager');
      INSERT INTO domain_events(id, event_type, entity_type, entity_id, organisation_id, actor_id) VALUES
        (31,'accident.workstream_assigned','accident_case_workstream','${id(71)}','${ORG_A}','${id(4)}');`)
    await db.query(`SELECT consume_event_email_accident_step(d) FROM domain_events d WHERE id=31`)
    // Managers in org A: sara (real), gone (locked), test user (skipped), unverified (no confirmed address).
    assert.deepEqual((await outbox(db, 'accident.step_assigned')).map(r => r.to_address), ['sara@example.com'])

    await db.exec(`DELETE FROM email_outbox;
      INSERT INTO email_event_settings(organisation_id, event_key, enabled) VALUES ('${ORG_A}','assignment.new', false);
      INSERT INTO domain_events(id, event_type, entity_type, entity_id, organisation_id) VALUES
        (32,'accident.workstream_assigned','accident_case_workstream','${id(71)}','${ORG_A}');`)
    await db.query(`SELECT consume_event_email_accident_step(d) FROM domain_events d WHERE id=32`)
    assert.equal((await outbox(db, 'accident.step_assigned')).length, 0)
  })
})

test('accident step: a broken event never raises (other consumers must not retry)', async () => {
  await withDb(async db => {
    await db.exec(`INSERT INTO domain_events(id, event_type, entity_type, entity_id, organisation_id) VALUES
      (41,'accident.workstream_assigned','accident_case_workstream','not-a-uuid','${ORG_A}');`)
    await db.query(`SELECT consume_event_email_accident_step(d) FROM domain_events d WHERE id=41`)
    assert.equal((await outbox(db, 'accident.step_assigned')).length, 0)
  })
})

test('workshop waiting: batched per supervisor, first email at once, held for 30 minutes, then the full count', async () => {
  await withDb(async db => {
    const add = (asset, mins) => db.query(`INSERT INTO workshop_status_records(organisation_id, asset_no, confirm_status, routed_to, routed_at)
      VALUES ($1, $2, 'pending_confirm', ARRAY[$3::uuid, $4::uuid], now() - make_interval(mins => $5))`, [ORG_A, asset, id(5), id(2), mins])
    await add('TM1', 3); await add('TM2', 2)
    await db.query(`SELECT workshop_intake_notify($1, ARRAY[$2::uuid, $3::uuid])`, [ORG_A, id(5), id(2)])
    let rows = await outbox(db, 'workshop.waiting')
    assert.equal(rows.length, 1, 'one email for two vehicles; the synthetic driver gets none')
    assert.equal(rows[0].to_address, 'sara@example.com')
    assert.equal(rows[0].data.count, 2)
    assert.deepEqual(rows[0].data.assets, ['TM2', 'TM1'])
    assert.equal((await db.query('SELECT count(*)::int n FROM test_notices')).rows[0].n, 2, 'in-app notice unchanged')

    // A third vehicle 1 minute later: held back (sent < 30 minutes ago), even through the sweep.
    await add('TM3', 0)
    await db.query(`SELECT workshop_intake_notify($1, ARRAY[$2::uuid])`, [ORG_A, id(5)])
    await db.query(`SELECT email_workshop_waiting_sweep()`)
    assert.equal((await outbox(db, 'workshop.waiting')).length, 1)

    // 30 minutes later the sweep sends one email with the whole waiting count.
    await db.query(`UPDATE email_batch_marks SET last_sent_at = now() - interval '31 minutes'`)
    assert.equal((await db.query(`SELECT email_workshop_waiting_sweep() n`)).rows[0].n, 1)
    rows = await outbox(db, 'workshop.waiting')
    assert.equal(rows.length, 2)
    assert.ok(rows.some(r => r.data.count === 3))
    // Nothing new: the sweep sends nothing again.
    await db.query(`UPDATE email_batch_marks SET last_sent_at = now() - interval '2 hours'`)
    assert.equal((await db.query(`SELECT email_workshop_waiting_sweep() n`)).rows[0].n, 0)
  })
})

test('workshop waiting: turned off for the org sends nothing; in-app notice still goes', async () => {
  await withDb(async db => {
    await db.exec(`INSERT INTO email_event_settings(organisation_id, event_key, enabled) VALUES ('${ORG_A}','workshop.waiting', false);`)
    await db.query(`INSERT INTO workshop_status_records(organisation_id, asset_no, confirm_status, routed_to, routed_at)
      VALUES ($1, 'TM9', 'pending_confirm', ARRAY[$2::uuid], now())`, [ORG_A, id(5)])
    await db.query(`SELECT workshop_intake_notify($1, ARRAY[$2::uuid])`, [ORG_A, id(5)])
    assert.equal((await outbox(db, 'workshop.waiting')).length, 0)
    assert.equal((await db.query('SELECT count(*)::int n FROM test_notices')).rows[0].n, 1)
  })
})

test('daily summary: yesterday in Riyadh, scoped to the reader, a failed read is null not 0, deduped per day', async () => {
  await withDb(async db => {
    const day = '2026-11-27'
    await db.exec(`
      UPDATE profiles SET country = ARRAY['KSA'], sites = ARRAY['NHC'] WHERE id = '${id(5)}';
      INSERT INTO inspections(organisation_id, country, site, status, approval_status, inspection_date, completed_date) VALUES
        ('${ORG_A}','KSA','NHC','Done','approved','${day}','${day}'),
        ('${ORG_A}','KSA','JED','Done','approved','${day}','${day}'),
        ('${ORG_A}','UAE','DXB','Done','approved','${day}','${day}'),
        ('${ORG_A}','KSA','NHC','Done','approved','2026-11-26','2026-11-26'),
        ('${ORG_A}','KSA','NHC','In Progress','pending_approval','${day}',null),
        ('${ORG_B}','KSA','NHC','Done','approved','${day}','${day}');
      INSERT INTO checklist_submissions(organisation_id, country, site, approval_status) VALUES ('${ORG_A}','KSA','NHC','pending');
      -- 22:30 on the 26th UTC = 01:30 on the 27th in Riyadh: counts. 21:30 on the 27th UTC = 00:30 on the 28th: does not.
      INSERT INTO accidents(id, organisation_id, site, country, created_at) VALUES
        ('${id(80)}','${ORG_A}','NHC','KSA','2026-11-26 22:30+00'),
        ('${id(81)}','${ORG_A}','NHC','KSA','2026-11-27 21:30+00');
      INSERT INTO workshop_status_records(organisation_id, country, site, asset_no, first_seen_at, removed_at) VALUES
        ('${ORG_A}','KSA','NHC','TM1','2026-11-27 06:00+00', null),
        ('${ORG_A}','KSA','NHC','TM2','2026-11-20 06:00+00','2026-11-27 09:00+00');
      INSERT INTO test_due VALUES ('${ORG_A}','KSA','NHC'), ('${ORG_A}','KSA','JED'), ('${ORG_B}','KSA','NHC');`)

    const dry = (await db.query(`SELECT email_daily_summary_enqueue('${day}', true) r`)).rows[0].r
    assert.equal(dry.queued, 0)
    assert.equal((await outbox(db, 'summary.daily')).length, 0, 'dry run queues nothing')

    const res = (await db.query(`SELECT email_daily_summary_enqueue('${day}') r`)).rows[0].r
    // Org A: owner (Admin, all sites) and sara (Manager, KSA/NHC). Org B: its own manager, its own numbers.
    assert.equal(res.queued, 3)
    const rows = await outbox(db, 'summary.daily')
    const owner = rows.find(r => r.to_address === 'owner@example.com').data
    const sara = rows.find(r => r.to_address === 'sara@example.com').data
    assert.equal(owner.inspections_done, 3, 'admin sees every site in the org, not other orgs, not other days')
    assert.equal(sara.inspections_done, 1, 'manager sees only KSA / NHC')
    assert.equal(sara.accidents_reported, 1, 'Riyadh day boundaries')
    assert.equal(sara.workshop_in, 1)
    assert.equal(sara.workshop_released, 1)
    assert.equal(sara.tyres_attention, 1)
    assert.equal(owner.tyres_attention, 2)
    assert.equal(sara.approvals_waiting, 2)
    assert.equal(sara.unreadable, 0)
    assert.equal(sara.summary_label, '27 Nov 2026')
    const other = rows.find(r => r.to_address === 'mgr@other.com').data
    assert.equal(other.tyres_attention, 0, 'org B manager has no country scope: sees only rows without a country')

    // Running again the same day queues nothing new.
    assert.equal((await db.query(`SELECT email_daily_summary_enqueue('${day}') r`)).rows[0].r.queued, 0)

    // The tyre engine fails: that one number becomes null, the rest still send.
    await db.exec(`INSERT INTO test_flags VALUES ('due_broken')`)
    await db.query(`SELECT email_daily_summary_enqueue('2026-11-26')`)
    const next = (await db.query(`SELECT data FROM email_outbox WHERE dedupe_key LIKE '%2026-11-26' AND to_address='sara@example.com'`)).rows[0].data
    assert.equal(next.tyres_attention, null)
    assert.equal(next.unreadable, 1)
    assert.equal(next.inspections_done, 1)
  })
})

test('daily summary honours personal opt-out and the org switch', async () => {
  await withDb(async db => {
    await db.exec(`INSERT INTO notification_preferences(user_id, organisation_id, channel_email) VALUES ('${id(5)}','${ORG_A}', false);`)
    const r = (await db.query(`SELECT email_daily_summary_enqueue('2026-11-27') r`)).rows[0].r
    assert.equal(r.opted_out, 1)
    assert.deepEqual((await outbox(db, 'summary.daily')).map(x => x.to_address), ['mgr@other.com', 'owner@example.com'])
    await db.exec(`DELETE FROM email_outbox; INSERT INTO email_event_settings(organisation_id, event_key, enabled) VALUES ('${ORG_A}','summary.daily', false);`)
    await db.query(`SELECT email_daily_summary_enqueue('2026-11-28')`)
    assert.deepEqual((await outbox(db, 'summary.daily')).map(x => x.to_address), ['mgr@other.com'], 'org A switched off, org B still on')
  })
})

test('schedules exist, carry no secret, and new functions are not callable by clients', async () => {
  await withDb(async db => {
    const jobs = (await db.query(`SELECT jobname, schedule, command FROM cron.job ORDER BY jobname`)).rows
    assert.deepEqual(jobs.map(j => [j.jobname, j.schedule]), [
      ['email-daily-summary', '0 4 * * *'], ['email-dispatch', '* * * * *'], ['email-workshop-waiting', '*/5 * * * *']])
    for (const j of jobs) assert.doesNotMatch(j.command, /secret|Bearer|[0-9a-f]{32}/i)
    // The kick posts only when something is due, and with the secret from cron_config.
    await db.query(`SELECT email_dispatch_kick()`)
    assert.equal((await db.query('SELECT count(*)::int n FROM net.calls')).rows[0].n, 0)
    for (const fn of ['public.consume_event_email_accident_step(public.domain_events)', 'public.email_workshop_waiting_sweep(uuid,uuid[])',
      'public.email_daily_summary_enqueue(date,boolean)', 'public._email_daily_summary_data(uuid,uuid,date,jsonb)', 'public.email_event_enabled(uuid,text)']) {
      for (const role of ['anon', 'authenticated']) {
        assert.equal((await db.query(`SELECT has_function_privilege('${role}', '${fn}', 'EXECUTE') ok`)).rows[0].ok, false, `${role} ${fn}`)
      }
    }
    assert.equal((await db.query(`SELECT has_table_privilege('authenticated','public.email_batch_marks','SELECT') ok`)).rows[0].ok, false)
    // Re-running the migration does not add duplicate jobs.
    await db.exec(P3)
    assert.equal((await db.query(`SELECT count(*)::int n FROM cron.job`)).rows[0].n, 3)
  })
})
