import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { EMAIL_STUBS, SEED_USERS, id, ORG_A, ORG_B } from './fixtures/email_stubs.mjs'

const read = f => readFile(new URL(`../migrations/${f}`, import.meta.url), 'utf8')
const MIGS = [await read('20261128110000_workflow_notify_true_delivery.sql'), await read('20261128111000_email_outbox.sql')]
const P2 = await read('20261128112000_email_event_settings.sql')

const ACCIDENT_STUBS = `
  CREATE TABLE net._http_response(id bigint, status_code int, content text, error_msg text);
  CREATE TABLE public.organisations(id uuid primary key);
  INSERT INTO public.organisations VALUES ('${ORG_A}'),('${ORG_B}');
  CREATE TABLE public.domain_events(id bigint primary key, event_type text, entity_type text, entity_id text, organisation_id uuid, created_at timestamptz default now());
  CREATE TABLE public.accidents(id uuid primary key, organisation_id uuid, reference_no text, asset_no text, site text, country text, severity text,
    injuries boolean default false, workflow_stage text default 'reported', claim_status text, accident_type text, estimated_damage_cost numeric,
    final_amount numeric, repair_cost numeric, vor boolean default false, third_party_involved boolean default false, department text,
    incident_date date, driver_name text, description text);
  CREATE TABLE public.accident_routing_rules(organisation_id uuid, active boolean, event_key text, match_severities text[], match_types text[],
    match_sites text[], match_countries text[], min_cost numeric, require_injury boolean default false, require_vor boolean default false,
    require_third_party boolean default false, departments text[], to_roles text[], cc_roles text[], escalate_roles text[]);
  CREATE TABLE public.notifications(id uuid default gen_random_uuid() primary key, user_id uuid, type text, title text, body text,
    entity_type text, entity_id uuid, read boolean default false, created_at timestamptz default now(), dedupe_key text unique);
  CREATE FUNCTION public._user_push_tokens(uuid) RETURNS SETOF text LANGUAGE sql AS $$ SELECT 'ExponentPushToken[x-' || $1 || ']' $$;
  CREATE FUNCTION public.accident_notify_configured(uuid, text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE FUNCTION public._accident_is_test_profile(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE FUNCTION public.accident_severity_label(text) RETURNS text LANGUAGE sql AS $$ SELECT initcap($1) $$;
  CREATE FUNCTION public.accident_stage_label(text) RETURNS text LANGUAGE sql AS $$ SELECT initcap($1) $$;
  CREATE FUNCTION public.accident_pending_action(text) RETURNS text LANGUAGE sql AS $$ SELECT 'Review' $$;
  CREATE FUNCTION public.accident_notify_dedupe_key(text, text, uuid, text, timestamptz) RETURNS text LANGUAGE sql AS $$ SELECT $1||$2||$3 $$;
  CREATE TABLE public.mail_cfg(org uuid, enabled text, email_to text, email_cc text, prefix text);
  CREATE FUNCTION public.accident_mail_config(p uuid) RETURNS TABLE(source text, emails_enabled text, email_to text, email_cc text, subject_prefix text)
    LANGUAGE sql AS $$ SELECT coalesce((SELECT 'organisation' FROM public.mail_cfg WHERE org = p), 'none'),
      (SELECT enabled FROM public.mail_cfg WHERE org = p), (SELECT email_to FROM public.mail_cfg WHERE org = p),
      (SELECT email_cc FROM public.mail_cfg WHERE org = p), (SELECT prefix FROM public.mail_cfg WHERE org = p) $$;
  INSERT INTO public.mail_cfg VALUES ('${ORG_A}', 'true', 'tpe@example.sa, ops@example.sa', 'bad@users.tyrepulse.app', '[GCC]');
`

async function withDb(fn) {
  const db = new PGlite()
  try {
    await db.exec(EMAIL_STUBS + SEED_USERS + ACCIDENT_STUBS + MIGS.join('\n') + P2)
    await fn(db)
  } finally { await db.close() }
}

test('migration copies the accident mailbox into org settings without the synthetic address', async () => {
  await withDb(async db => {
    const rows = (await db.query(`SELECT event_key, enabled, external_addresses FROM email_event_settings WHERE organisation_id=$1 ORDER BY event_key`, [ORG_A])).rows
    assert.equal(rows.length, 3)
    assert.deepEqual(rows[0].external_addresses.sort(), ['ops@example.sa', 'tpe@example.sa'])
    assert.equal(rows[0].enabled, true)
    assert.equal((await db.query(`SELECT count(*)::int n FROM email_event_settings WHERE organisation_id=$1`, [ORG_B])).rows[0].n, 0)
  })
})

test('accident event: push without email; email per verified recipient + mailbox; dedupe on replay', async () => {
  await withDb(async db => {
    await db.exec(`
      INSERT INTO accidents(id, organisation_id, reference_no, asset_no, site, country, severity, driver_name, description)
        VALUES ('${id(50)}','${ORG_A}','ACC-1','TM514','NHC','KSA','severe','Ali','Rear-ended');
      INSERT INTO accident_routing_rules VALUES ('${ORG_A}', true, null, '{}','{}','{}','{}', null, false,false,false, '{Ops}', '{Admin,Manager}', '{}', '{}');
      INSERT INTO domain_events VALUES (7, 'accident.reported', 'accident', '${id(50)}', '${ORG_A}');`)
    await db.query(`SELECT consume_event_accident_notify(d) FROM domain_events d WHERE id=7`)
    const wn = (await db.query('SELECT payload FROM workflow_notifications')).rows[0].payload
    assert.equal(wn.email, undefined)
    assert.ok(wn.recipients.every(r => r.email === undefined))
    const out = (await db.query(`SELECT to_address, audience, template_key, data->>'subject_prefix' p FROM email_outbox ORDER BY to_address`)).rows
    // owner (Admin, real), sara (Manager, real, arabic), two mailboxes. Not: synthetic driver, locked user, other org.
    assert.deepEqual(out.map(r => r.to_address), ['ops@example.sa', 'owner@example.com', 'sara@example.com', 'tpe@example.sa'])
    assert.equal(out.find(r => r.to_address === 'ops@example.sa').audience, 'external')
    assert.equal(out[0].template_key, 'accident.reported')
    assert.equal(out[0].p, '[GCC]')
    assert.ok((await db.query('SELECT count(*)::int n FROM net.calls')).rows[0].n >= 1, 'dispatcher kicked')
    await db.query(`SELECT consume_event_accident_notify(d) FROM domain_events d WHERE id=7`)
    assert.equal((await db.query('SELECT count(*)::int n FROM email_outbox')).rows[0].n, 4)
  })
})

test('a disabled email type sends no email', async () => {
  await withDb(async db => {
    await db.exec(`
      UPDATE email_event_settings SET enabled=false WHERE event_key='accident.reported';
      INSERT INTO accidents(id, organisation_id, reference_no, site, severity) VALUES ('${id(51)}','${ORG_A}','ACC-2','NHC','minor');
      INSERT INTO domain_events VALUES (8, 'accident.reported', 'accident', '${id(51)}', '${ORG_A}');`)
    await db.query(`SELECT consume_event_accident_notify(d) FROM domain_events d WHERE id=8`)
    assert.equal((await db.query('SELECT count(*)::int n FROM email_outbox')).rows[0].n, 0)
    assert.ok((await db.query('SELECT count(*)::int n FROM notifications')).rows[0].n > 0, 'in-app still sent')
  })
})

test('settings RPC: admin only, own org, validated, history written', async () => {
  await withDb(async db => {
    await db.exec(`SET test.actor='${id(5)}'`) // manager
    await assert.rejects(db.query('SELECT get_email_event_settings()'))
    await db.exec(`SET test.actor='${id(1)}'`) // admin org A
    const list = (await db.query('SELECT get_email_event_settings() s')).rows[0].s
    assert.ok(list.find(x => x.event_key === 'digest.daily').optional)
    await assert.rejects(db.query(`SELECT set_email_event_setting('digest.daily', true, '{Admin}', ARRAY['${id(3)}']::uuid[], '{}')`), /not in your organisation/)
    await assert.rejects(db.query(`SELECT set_email_event_setting('digest.daily', true, '{Admin}', '{}', ARRAY['a@b.com','x@users.tyrepulse.app'])`), /cannot receive/)
    const eleven = Array.from({ length: 11 }, (_, i) => `m${i}@ex.com`)
    await assert.rejects(db.query(`SELECT set_email_event_setting('digest.daily', true, '{}', '{}', $1)`, [eleven]), /At most 10/)
    await assert.rejects(db.query(`SELECT set_email_event_setting('nope', true, '{}', '{}', '{}')`), /Unknown/)
    await db.query(`SELECT set_email_event_setting('digest.daily', true, '{Manager}', ARRAY['${id(5)}']::uuid[], ARRAY['Boss@Ex.com'])`)
    const row = (await db.query(`SELECT recipient_roles, external_addresses FROM email_event_settings WHERE event_key='digest.daily'`)).rows[0]
    assert.deepEqual(row, { recipient_roles: ['Manager'], external_addresses: ['boss@ex.com'] })
    assert.equal((await db.query('SELECT count(*)::int n FROM email_event_settings_history')).rows[0].n, 1)
  })
})

test('webhook record: replay ignored, bounce suppresses the address', async () => {
  await withDb(async db => {
    assert.equal((await db.query(`SELECT email_webhook_record('msg1','email.bounced','re_1','Owner@Example.com','{}') r`)).rows[0].r, 'ok')
    assert.equal((await db.query(`SELECT email_webhook_record('msg1','email.bounced','re_1','owner@example.com','{}') r`)).rows[0].r, 'replay')
    assert.equal((await db.query(`SELECT count(*)::int n FROM email_suppressions WHERE address='owner@example.com'`)).rows[0].n, 1)
    for (const fn of ['public.email_webhook_record(text,text,text,text,jsonb)', 'public.email_event_recipients(uuid,text,text,text,text[])']) {
      assert.equal((await db.query(`SELECT has_function_privilege('authenticated','${fn}','EXECUTE') ok`)).rows[0].ok, false)
    }
  })
})
