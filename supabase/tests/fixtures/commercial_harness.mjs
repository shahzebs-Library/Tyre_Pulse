// PGlite harness for the commercial-readiness (COM-*) pending migrations.
//
// Built on commercial_base_harness.mjs (identity helpers there are md5-checked copies of
// production). What is FAITHFUL here: every function loaded from commercial_live_functions.sql
// and the short functions in LIVE_INLINE below; each is checked by md5(prosrc) against the value
// recorded from production (project jhssdmeruxtrlqnwfksc) on 2026-11-12.
// What is a STUB (production differs): the tables carry only the columns the code under test
// touches; accident_apply_tokens, the accident label functions, _user_push_tokens,
// emit_domain_event, app_write_country_ok, tyre_scrap_allowed and _log_scrap_action are small
// stand-ins; row security is only set up where a test says so.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDb, ORG_A, ORG_B, USERS } from './commercial_base_harness.mjs';

export { ORG_A, ORG_B, USERS };
export { asUser, asService, pendingMigration, written, code } from './commercial_base_harness.mjs';

// md5(prosrc) recorded from production on 2026-11-12.
export const COM_LIVE_MD5 = {
  notify_elevated_users: '514bde7dd566ff5319e19efadce78b38',
  notify_workshop_parts: 'c82bbccaef962719057295edae48240d',
  tyre_life_km_cap: '8785f64d647453fd04301c27a821afef',
  scrap_tyre_by_serial: '31586bca910c92846086d193ca28aeeb',
  evaluate_alert_thresholds: 'e0a7f85ddb78e63045c3b49258a3f5e8',
  consume_event_accident_case_notify: '918402c927bebf8b100eb3413625b259',
  consume_event_accident_notify: '96ddb24abd8a2dec2865abeecd14997a',
  currency_for_country: 'ab4f3010fac256fc05a7ba761906eb8d',
  checklist_is_supervisor: '33606170b8cf41725880dadfabbf93e3',
  checklist_is_area_manager: '3821706c0b9257313d52e01f4229678f',
  tyre_km_life: '1b2b2d9f89f12a41dad88dba7d151470',
};

const CRLF = '\r\n';

// Short live functions kept inline (two of them use CRLF line ends in production).
const LIVE_INLINE = `
  create function public.currency_for_country(p_country text) returns text language sql stable set search_path to 'public' as
  $f$
  select c.currency from public.country_currency c
   where upper(btrim(c.country)) = upper(btrim(coalesce(p_country, '')))
   limit 1;
$f$;
  create function public.checklist_is_supervisor() returns boolean language sql stable security definer set search_path to 'public' as
  $f$${CRLF}  select public.is_super_admin() or public.get_my_role() = any (array[${CRLF}    'Admin','Maintenance Supervisor','Workshop Supervisor',${CRLF}    'PMV Manager','Workshop Area Manager','Workshop Maintenance Area Manager',${CRLF}    'Tyre Data Collector'${CRLF}  ]);${CRLF}$f$;
  create function public.checklist_is_area_manager() returns boolean language sql stable security definer set search_path to 'public' as
  $f$
  select public.is_super_admin() or public.get_my_role() = any (array[
    'Admin','Director','PMV Manager','Workshop Area Manager','Workshop Maintenance Area Manager'
  ]);
$f$;
  create function public.tyre_km_life(p_fit numeric, p_rem numeric, p_total numeric, p_vehicle_type text) returns numeric language sql immutable set search_path to 'public' as
  $f$
  select case when v.km is not null and v.km <= public.tyre_life_km_cap(p_vehicle_type) then v.km end
  from (select case
    when p_fit > 1 and p_rem > p_fit then p_rem - p_fit
    when p_fit > 1 and p_total > 0 then p_total
    when p_fit = 1 then null
    when p_fit = 0 and p_total > 0 then p_total
    when p_fit = 0 and p_rem > 0 then p_rem
    when p_fit is null and p_total > 0 then p_total
  end as km) v
$f$;
`;

const SCHEMA_SQL = `
  alter table public.system_config add column value_text text;
  create table public.settings (key text primary key, value jsonb);
  create table auth.users (id uuid primary key, email text);
  insert into auth.users (id, email) select id, 'user-' || left(id::text, 8) || '@example.test' from public.profiles;
  alter table public.organisations add column logo_url text;

  create table public.notifications (
    id uuid primary key default gen_random_uuid(), user_id uuid not null, type text default 'info',
    title text not null, body text, entity_type text, entity_id uuid, created_at timestamptz default now());
  create table public.domain_events (
    id bigint generated always as identity primary key, event_type text, entity_type text, entity_id text,
    organisation_id uuid, actor_id uuid, payload jsonb default '{}'::jsonb);
  create table public.workflow_notifications (
    id bigint generated always as identity primary key, event_id bigint unique, organisation_id uuid,
    instance_id uuid, event_type text, payload jsonb, recipient_count int, status text);

  create table public.accidents (
    id uuid primary key default gen_random_uuid(), organisation_id uuid not null, reference_no text, case_no text,
    asset_no text, site text, country text, severity text, injuries boolean default false,
    workflow_stage text default 'reported', claim_status text, vor boolean default false, vor_since timestamptz,
    third_party_involved boolean default false, accident_type text, estimated_damage_cost numeric,
    final_amount numeric, repair_cost numeric, department text, status text default 'reported');
  create table public.accident_routing_rules (
    organisation_id uuid, active boolean default true, event_key text, match_severities text[], match_types text[],
    match_sites text[], match_countries text[], min_cost numeric, require_injury boolean default false,
    require_vor boolean default false, require_third_party boolean default false,
    departments text[], to_roles text[], cc_roles text[], escalate_roles text[]);
  create table public.accident_email_templates (
    organisation_id uuid, key text, subject text, body_html text, active boolean default true, approved boolean default true);
  -- STUBS
  create function public._user_push_tokens(p uuid) returns table (tok text) language sql stable as $$ select null::text where false $$;
  create function public.accident_severity_label(s text) returns text language sql immutable as $$ select initcap(coalesce(s, 'unknown')) $$;
  create function public.accident_stage_label(s text) returns text language sql immutable as $$ select initcap(replace(coalesce(s, ''), '_', ' ')) $$;
  create function public.accident_pending_action(s text) returns text language sql immutable as $$ select 'Review ' || coalesce(s, '') $$;
  create function public.accident_apply_tokens(tpl text, acc public.accidents, v_dept text) returns text language sql stable as
    $$ select replace(replace(tpl, '{{reference_no}}', coalesce(acc.reference_no, '-')), '{{department}}', coalesce(v_dept, '-')) $$;
  create function public.emit_domain_event(p_type text, p_entity_type text, p_entity_id text, p_payload jsonb, p_org uuid, p_actor uuid)
    returns void language sql as
    $$ insert into public.domain_events (event_type, entity_type, entity_id, payload, organisation_id, actor_id)
       values (p_type, p_entity_type, p_entity_id, p_payload, p_org, p_actor) $$;

  create table public.parts_requests (
    id uuid primary key default gen_random_uuid(), organisation_id uuid not null default public.app_current_org(),
    asset_no text, part_name text, status text not null default 'requested', requested_by uuid default auth.uid());
  grant select, insert, update on public.parts_requests to authenticated;

  create table public.alert_thresholds (
    id uuid primary key default gen_random_uuid(), user_id uuid not null, org_id uuid, name text not null,
    metric text not null, operator text not null, threshold numeric not null, site_filter text, brand_filter text,
    notify_in_app boolean not null default true, active boolean not null default true,
    triggered_count int not null default 0, last_triggered_at timestamptz);
  create table public.inspections (
    id uuid primary key default gen_random_uuid(), organisation_id uuid, site text, asset_no text,
    created_at timestamptz default now(), pressure_reading numeric, tyre_conditions jsonb,
    completed_date date, scheduled_date date, approval_status text);
  create table public.tyre_records (
    id uuid primary key default gen_random_uuid(), organisation_id uuid, serial_no text, site text, brand text,
    country text, issue_date date, risk_level text, status text);

  create table public.tyre_status_marks (
    id uuid primary key default gen_random_uuid(), serial text not null, mark_type text not null,
    organisation_id uuid default public.app_current_org(), country text, created_by uuid,
    created_at timestamptz not null default now(), reason text, prior_status jsonb,
    constraint tyre_status_marks_mark_type_check check (mark_type = any (array['returned','written_off','scrap'])),
    constraint tyre_status_marks_serial_mark_type_key unique (serial, mark_type));
  create table public.scrap_audit (action text, serial text, old jsonb, new jsonb, country text, org uuid, actor uuid);
  -- STUBS for the scrap function's helpers
  create function public.app_write_country_ok(c text) returns boolean language sql stable as $$ select true $$;
  create function public.tyre_scrap_allowed() returns boolean language sql stable security definer set search_path to 'public' as
    $$ select public.app_is_active() $$;
  create function public._log_scrap_action(p_action text, p_serial text, p_old jsonb, p_new jsonb, p_country text)
    returns void language sql security definer set search_path to 'public' as
    $$ insert into public.scrap_audit values (p_action, p_serial, p_old, p_new, p_country, public.app_current_org(), auth.uid()) $$;

  create table public.warranty_claims (
    id uuid primary key default gen_random_uuid(),
    claim_no text not null default ('WC-' || substr(gen_random_uuid()::text, 1, 8)),
    serial_number text, country text, site text,
    organisation_id uuid not null default public.app_current_org(),
    constraint warranty_claim_no_country_uniq unique (claim_no, country));
  grant select, insert on public.warranty_claims to authenticated;

  create table public.country_currency (
    country text primary key, currency text not null, currency_name text, is_base boolean not null default false);
  insert into public.country_currency values
    ('KSA', 'SAR', 'Saudi Riyal', true), ('UAE', 'AED', 'UAE Dirham', false), ('Egypt', 'EGP', 'Egyptian Pound', false);
`;

const liveSql = await readFile(new URL('./commercial_live_functions.sql', import.meta.url), 'utf8');

/** A database with the stub schema and the faithful live functions loaded and md5-verified. */
export async function createCommercialDb() {
  const db = await createDb();
  await db.exec(SCHEMA_SQL);
  await db.exec(liveSql);
  await db.exec(LIVE_INLINE);
  await db.exec(`create trigger trg_notify_workshop_parts after insert or update on public.parts_requests
                   for each row execute function public.notify_workshop_parts();`);
  for (const [name, md5] of Object.entries(COM_LIVE_MD5)) {
    const { rows } = await db.query(
      "select md5(prosrc) m from pg_proc where pronamespace = 'public'::regnamespace and proname = $1", [name]);
    assert.equal(rows.length, 1, `${name} must exist exactly once`);
    assert.equal(rows[0].m, md5, `${name} is not a faithful copy of the live function`);
  }
  return db;
}

export const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
export const all = async (db, sql, params = []) => (await db.query(sql, params)).rows;
