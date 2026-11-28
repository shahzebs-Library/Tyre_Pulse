// Shared PGlite stubs for the email + notification migrations.
export const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
export const ORG_A = id(900)
export const ORG_B = id(901)

export const EMAIL_STUBS = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth; CREATE SCHEMA net; CREATE SCHEMA extensions; CREATE SCHEMA cron;
  CREATE FUNCTION extensions.gen_random_bytes(int) RETURNS bytea LANGUAGE sql AS $$ SELECT decode(md5(random()::text),'hex') $$;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.actor', true), '')::uuid $$;
  CREATE TABLE auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
  CREATE TABLE public.profiles(
    id uuid primary key, username text, full_name text, role text, organisation_id uuid, org_id uuid,
    approved boolean default true, locked boolean default false, language text, site text, sites text[], country text[],
    is_super_admin boolean default false, recovery_email text, recovery_email_verified_at timestamptz,
    created_at timestamptz default now());
  CREATE TABLE public.cron_config(name text primary key, value text);
  CREATE TABLE public.system_config(key text primary key, value text);
  CREATE TABLE public.notification_preferences(user_id uuid primary key, organisation_id uuid, channel_email boolean default true,
    channel_push boolean default true, quiet_start time, quiet_end time, timezone text, digest_frequency text default 'daily', min_priority text);
  CREATE SEQUENCE net.req_seq;
  CREATE TABLE net.calls(id bigint, url text, body jsonb);
  CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) RETURNS bigint
    LANGUAGE plpgsql AS $$ DECLARE v bigint := nextval('net.req_seq'); BEGIN INSERT INTO net.calls VALUES (v, url, body); RETURN v; END $$;
  CREATE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce((SELECT is_super_admin FROM public.profiles WHERE id = auth.uid()), false) $$;
  CREATE FUNCTION public.app_current_org() RETURNS uuid LANGUAGE sql AS $$ SELECT organisation_id FROM public.profiles WHERE id = auth.uid() $$;
  CREATE FUNCTION public.app_role() RETURNS text LANGUAGE sql AS $$ SELECT lower(role) FROM public.profiles WHERE id = auth.uid() $$;
  CREATE TABLE public.workflow_notifications(id bigint generated always as identity primary key, event_id bigint unique, organisation_id uuid, instance_id uuid,
    event_type text, payload jsonb default '{}', recipient_count int default 0, status text default 'pending', attempts int default 0,
    next_attempt_at timestamptz default now(), request_id bigint, response_status int, result jsonb, last_error text,
    created_at timestamptz default now(), delivered_at timestamptz);
`

/** Users: 1 real admin A, 2 synthetic driver A, 3 real manager B, 4 locked real A, 5 real A arabic. */
export const SEED_USERS = `
  INSERT INTO auth.users VALUES
    ('${id(1)}','owner@example.com', now()),
    ('${id(2)}','drv@users.tyrepulse.app', now()),
    ('${id(3)}','mgr@other.com', now()),
    ('${id(4)}','gone@example.com', now()),
    ('${id(5)}','sara@example.com', now());
  INSERT INTO public.profiles(id, username, full_name, role, organisation_id, org_id, locked, language, site, is_super_admin) VALUES
    ('${id(1)}','owner','Owner One','Admin','${ORG_A}','${ORG_A}',false,'en','NHC',true),
    ('${id(2)}','drv','Driver Two','Driver','${ORG_A}','${ORG_A}',false,'en','NHC',false),
    ('${id(3)}','mgr','Manager Three','Manager','${ORG_B}','${ORG_B}',false,'en','X',false),
    ('${id(4)}','gone','Gone Four','Manager','${ORG_A}','${ORG_A}',true,'en','NHC',false),
    ('${id(5)}','sara','Sara Five','Manager','${ORG_A}','${ORG_A}',false,'ar','NHC',false);
`
