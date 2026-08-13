-- =====================================================================
-- V535  THE CRON JOBS STOP CARRYING A BAKED-IN KEY
-- STATUS: APPLIED LIVE 2026-08-12 (project jhssdmeruxtrlqnwfksc)
--         v535_cron_anon_key_from_config  - seed + the two cron jobs
--         v535b_workflow_deliverer_reads_anon_key
--         v535c_deliver_workflow_notifications_reads_anon_key
--
-- VERIFIED AFTER APPLYING: cron_config.anon_key seeded; both cron jobs active,
-- carrying no literal and reading from cron_config; and a whole-database sweep
-- finds NO literal key left in any cron job or any function body.
--
-- NOTE ON SCOPE, worth keeping. This file was written against the repo and
-- named THREE call sites. The live sweep found FOUR: public.
-- deliver_workflow_notifications also carried the key and appears in no
-- MIGRATIONS_V*.sql file at all. The repo is a lower bound on what exists in
-- this database - sweep the catalog, do not grep the repo.
-- =====================================================================
--
-- WHAT THIS IS, AND WHAT IT IS NOT
-- -------------------------------
-- Three scheduled jobs post to edge functions with a literal Supabase key in
-- the Authorization header, written directly into the migration text:
--
--   V61  send-scheduled-reports       cron '*/15 * * * *'
--   V98  embed-knowledge-documents    cron '*/10 * * * *'
--   V119 consume_workflow_notifications  (plpgsql, called by its own cron job)
--
-- THIS IS NOT A LEAKED SECRET. The value is the project's `anon` key. An anon
-- key is publishable by design - it ships in every browser bundle and every
-- APK, it authorises nothing on its own, and RLS is what actually guards the
-- data. Rotating it in a panic would be the wrong reading of this file.
--
-- THE REAL PROBLEM IS OPERATIONAL. Because the key is baked into three
-- function bodies rather than read from one place, rotating it - for any
-- reason, including a routine key migration - silently breaks all three jobs.
-- Nothing raises: pg_net posts, gets a 401, and the cron run still reports
-- success. Scheduled reports stop arriving, embeddings stop being generated,
-- and push notifications stop being delivered, with no error anywhere a person
-- looks. That failure mode is the reason to fix it, not secrecy.
--
-- THE FIX
-- -------
-- Move the value into `cron_config`, which ALREADY holds `cron_secret` and
-- `workflow_notify_secret` and is ALREADY read inline by these same jobs. So
-- this introduces no new mechanism, no new table and no new grant - it makes
-- the key follow the pattern the secrets beside it already follow. After this,
-- a rotation is one UPDATE and all three jobs pick it up on their next tick.
--
-- WHAT IS DELIBERATELY NOT DONE HERE
-- ----------------------------------
-- The Authorization header is KEPT rather than removed. V61's own comment says
-- the real gate is `x-cron-secret`, and workflow-notify is recorded as
-- deployed with verify_jwt=false - which would make the header decorative and
-- deletable. But this session could not read the live `verify_jwt` flag of each
-- function, and deleting a header that turns out to be load-bearing breaks the
-- job in exactly the silent way described above. Sourcing the same value from
-- one place is behaviour-identical and carries no such risk. If someone later
-- confirms all three functions are verify_jwt=false, dropping the header
-- entirely is the better end state and this file becomes unnecessary.
--
-- ORDER IS LOAD-BEARING: seed the value BEFORE re-scheduling the jobs. A job
-- re-scheduled against an empty cron_config posts `Bearer ` and 401s.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Seed the key from the job that already carries it.
--
-- Read out of the live cron command rather than pasted in, so this file never
-- becomes a second place the value is written down - which is the whole point.
-- If the regex finds nothing the DO block RAISES rather than seeding an empty
-- string, because an empty key would break every job at step 2.
-- ---------------------------------------------------------------------
do $$
declare
  v_key text;
begin
  select (regexp_match(command, 'Bearer\s+(ey[A-Za-z0-9_.\-]+)'))[1]
    into v_key
    from cron.job
   where jobname = 'send-scheduled-reports'
   limit 1;

  if v_key is null or length(v_key) < 40 then
    -- Fall back to the notification deliverer, whose key lives in the function
    -- body rather than the cron command.
    select (regexp_match(pg_get_functiondef(p.oid), 'Bearer\s+(ey[A-Za-z0-9_.\-]+)'))[1]
      into v_key
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'consume_workflow_notifications'
     limit 1;
  end if;

  if v_key is null or length(v_key) < 40 then
    raise exception
      'V535: could not recover the anon key from any existing job. Seed it by hand with: insert into public.cron_config(name,value) values (''anon_key'', ''<key>'') on conflict (name) do update set value = excluded.value;';
  end if;

  insert into public.cron_config (name, value)
  values ('anon_key', v_key)
  on conflict (name) do update set value = excluded.value;

  raise notice 'V535: seeded cron_config.anon_key (% chars)', length(v_key);
end $$;

comment on table public.cron_config is
  'Values the scheduled jobs read at run time: cron_secret, workflow_notify_secret, anon_key, and the sentry_* settings. Deny-all to clients; only SECURITY DEFINER functions and pg_cron read it. Rotating a key here is picked up by every job on its next tick - never bake one into a job body again.';

-- ---------------------------------------------------------------------
-- 2. Re-schedule the two cron jobs to read the key instead of carrying it.
--
-- cron.schedule() on an existing jobname REPLACES it in place, keeping the
-- job id and the schedule. The `x-cron-secret` line already reads cron_config
-- exactly this way, so the shape below is proven in production, not new.
-- ---------------------------------------------------------------------
select cron.schedule(
  'send-scheduled-reports',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url     := 'https://jhssdmeruxtrlqnwfksc.supabase.co/functions/v1/send-scheduled-reports',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select value from public.cron_config where name = 'anon_key'),
      'x-cron-secret', (select value from public.cron_config where name = 'cron_secret')
    ),
    body    := '{}'::jsonb
  );
  $job$
);

select cron.schedule(
  'embed-knowledge-documents',
  '*/10 * * * *',
  $job$
  select net.http_post(
    url     := 'https://jhssdmeruxtrlqnwfksc.supabase.co/functions/v1/embed-worker',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select value from public.cron_config where name = 'anon_key'),
      'x-cron-secret', (select value from public.cron_config where name = 'cron_secret')
    ),
    body    := '{}'::jsonb
  );
  $job$
);

-- ---------------------------------------------------------------------
-- 3. The two notification deliverer FUNCTIONS - done in V535b / V535c.
--
-- Originally left for a hand edit, because reproducing a 100+ line plpgsql body
-- from the V119 file risks shipping a stale copy over a version changed since.
-- V535b/V535c avoid that completely: each reads the LIVE definition with
-- pg_get_functiondef, swaps ONLY the literal via regexp_replace, and re-creates
-- from that exact text, aborting if the substitution matches nothing. No byte
-- is transcribed, so nothing can drift.
--
--   V535b  public.consume_workflow_notifications
--   V535c  public.deliver_workflow_notifications   <- found only by a live sweep
--
-- Both end with a whole-database check that no literal key remains in any cron
-- job or any function body. That check is what found the second function.
-- ---------------------------------------------------------------------

-- =====================================================================
-- VERIFY (run after applying; all three must hold)
-- =====================================================================
-- -- a) the key is seeded and non-trivial
-- select name, length(value) as len from public.cron_config where name = 'anon_key';
--
-- -- b) no cron job still carries a literal key
-- select jobname from cron.job where command ~ 'Bearer\s+ey';   -- expect 0 rows
--
-- -- c) the jobs still run. Wait one tick, then:
-- select jobname, status, return_message, start_time
--   from cron.job_run_details
--  where jobname in ('send-scheduled-reports','embed-knowledge-documents')
--  order by start_time desc limit 6;                            -- expect succeeded
--
-- -- d) and that the POST itself was accepted, not merely dispatched. A 401
-- --    here is the silent failure this migration exists to prevent, and it
-- --    will NOT show up as a failed cron run:
-- select status_code, created
--   from net._http_response order by created desc limit 6;      -- expect 2xx
--
-- ROLLBACK
--   Re-run the V61 and V98 cron.schedule blocks verbatim (they carry the
--   literal). cron_config.anon_key can be left in place; it harms nothing.
-- =====================================================================
