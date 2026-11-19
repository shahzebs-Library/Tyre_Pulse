-- Assertions for the DRAFT AI serial recognition migration (20261117130000), run on a PRIVATE COPY
-- of the LOCAL staging database only. Driver: supabase/tests/staging_ai_serial_recognition.sh
-- Prints one NOTICE line per check: PASS <name> / FAIL <name>. Everything runs inside one
-- transaction that is rolled back, so the copy ends as it started.
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.ok(p_name text, p_cond boolean) returns void language plpgsql as $$
begin
  raise notice '% %', case when coalesce(p_cond, false) then 'PASS' else 'FAIL' end, p_name;
end $$;
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ── fixtures (triggers off: test data, not an app path) ─────────────────────────────────
set local session_replication_role = replica;
insert into public.profiles (id, org_id, organisation_id, role, country, sites, approved, locked, is_super_admin, full_name, username)
values
  ('cccccccc-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Manager',     '{KSA}', '{ALL}', true, false, false, 'Syn Serial Manager KSA', 'syn_ser_01'),
  ('cccccccc-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Manager',     '{UAE}', '{ALL}', true, false, false, 'Syn Serial Manager UAE', 'syn_ser_02'),
  ('cccccccc-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Tyre Man',    '{KSA}', '{ALL}', true, false, false, 'Syn Serial Tyre Man',    'syn_ser_03'),
  ('cccccccc-0000-4000-8000-000000000004', 'bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002', 'Manager', '{KSA}', '{ALL}', true, false, false, 'Syn Serial Manager Beta', 'syn_ser_04');
insert into public.inspections (id, organisation_id, country, asset_no, inspection_date, site, title, status)
values ('dddddddd-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'KSA', 'TM001', '2026-05-01', 'NHC', 'syn serial', 'Done');
insert into public.ai_tyre_inspection_jobs (id, organisation_id, inspection_id, tyre_position, photo_ref, photo_sha256, status, prompt_version, model_version)
select ('eeeeeeee-0000-4000-8000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000001', 'dddddddd-0000-4000-8000-000000000001',
       pos, 'tp-storage://inspection-photos/syn/' || n || '.jpg', repeat(n::text, 64), 'processing', 'tyre-photo-v5-serial', 'claude-haiku-5-5'
  from (values (1, 'F1R'), (2, 'F1R'), (3, 'R2Ri'), (4, 'FL'), (5, 'R1Ro'), (6, 'F1R')) v(n, pos);
set local session_replication_role = origin;

create temp table tyre_before as select md5(string_agg(t::text, '|' order by id)) h from public.tyre_records t;
create temp table jobs_before as select md5(string_agg(j::text, '|' order by id)) h from public.ai_tyre_inspection_jobs j;
grant select on tyre_before, jobs_before to authenticated;

-- ── worker path (service role) ────────────────────────────────────────────────────────
select pg_temp.as_service();
select pg_temp.ok('match: current tyre on the resolved wheel',
  (public.ai_tyre_serial_record('eeeeeeee-0000-4000-8000-000000000001',
    '{"raw":"SYN-ALP-00004","source":"label","confidence":"high","status":"readable"}')->>'outcome') = 'match');
select pg_temp.ok('mismatch: the removed tyre serial on the same wheel',
  (public.ai_tyre_serial_record('eeeeeeee-0000-4000-8000-000000000002',
    '{"raw":"SYN-ALP-00003","source":"moulded","confidence":"medium","status":"readable"}')->>'outcome') = 'mismatch');
select pg_temp.ok('unreadable: serial on record but not read',
  (public.ai_tyre_serial_record('eeeeeeee-0000-4000-8000-000000000003',
    '{"raw":"","source":"none","confidence":"low","status":"unreadable"}')->>'outcome') = 'unreadable');
select pg_temp.ok('ambiguous: slot not on the asset layout',
  (public.ai_tyre_serial_record('eeeeeeee-0000-4000-8000-000000000004',
    '{"raw":"SYN-ALP-00004","source":"label","confidence":"high","status":"readable"}')->>'outcome') = 'ambiguous');
select pg_temp.ok('no_serial_on_record: nothing registered on that wheel',
  (public.ai_tyre_serial_record('eeeeeeee-0000-4000-8000-000000000005',
    '{"raw":"SYN-ALP-99999","source":"label","confidence":"high","status":"readable"}')->>'outcome') = 'no_serial_on_record');
select pg_temp.ok('server re-sanitises: a ? claimed readable is stored partial and never matched',
  (public.ai_tyre_serial_record('eeeeeeee-0000-4000-8000-000000000006',
    '{"raw":"SYN-ALP-0000?","normalized":"SYNALP00004","source":"label","confidence":"high","status":"readable"}')->>'outcome') = 'ambiguous');
-- (a separate statement: a subquery in the same SELECT cannot see the row the function just inserted)
select pg_temp.ok('server stored the reading as partial with ? and capped confidence',
  (select status = 'partial' and normalized = 'SYNALP0000?' and confidence = 'medium'
     from public.ai_tyre_serial_readings where job_id = 'eeeeeeee-0000-4000-8000-000000000006'));
select pg_temp.ok('the other company''s TM001 tyres are never used',
  (select not exists (select 1 from unnest(registered_serials) s where s like 'SYN-BET%')
     from public.ai_tyre_serial_readings where job_id = 'eeeeeeee-0000-4000-8000-000000000001'));
select pg_temp.ok('canonical wheel recorded from the position service',
  (select canonical_position = 'RHF1' and position_status = 'resolved'
     from public.ai_tyre_serial_readings where job_id = 'eeeeeeee-0000-4000-8000-000000000001'));
select pg_temp.ok('second call for a job returns the stored row, no duplicate',
  (public.ai_tyre_serial_record('eeeeeeee-0000-4000-8000-000000000001',
    '{"raw":"XXXX","source":"label","confidence":"high","status":"readable"}')->>'existing') = 'true'
  and (select count(*) = 1 from public.ai_tyre_serial_readings where job_id = 'eeeeeeee-0000-4000-8000-000000000001'));
select pg_temp.ok('needs_review set exactly on mismatch/ambiguous/unreadable',
  (select count(*) filter (where needs_review) = 4 and count(*) = 6 from public.ai_tyre_serial_readings));
select pg_temp.ok('no tyre record changed', (select h from tyre_before) = (select md5(string_agg(t::text, '|' order by id)) from public.tyre_records t));
select pg_temp.ok('no AI job changed', (select h from jobs_before) = (select md5(string_agg(j::text, '|' order by id)) from public.ai_tyre_inspection_jobs j));

-- ── append-only ───────────────────────────────────────────────────────────────────────
do $$ begin
  begin
    update public.ai_tyre_serial_readings set outcome = 'match' where job_id = 'eeeeeeee-0000-4000-8000-000000000002';
    perform pg_temp.ok('readings refuse update', false);
  exception when insufficient_privilege then perform pg_temp.ok('readings refuse update', true); end;
end $$;

-- ── grants ────────────────────────────────────────────────────────────────────────────
select pg_temp.ok('record RPC not executable by authenticated or anon',
  not has_function_privilege('authenticated', 'public.ai_tyre_serial_record(uuid,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.ai_tyre_serial_record(uuid,jsonb)', 'execute'));
select pg_temp.ok('no client insert/update/delete grant on readings or events',
  not has_table_privilege('authenticated', 'public.ai_tyre_serial_readings', 'insert')
  and not has_table_privilege('authenticated', 'public.ai_tyre_serial_readings', 'update')
  and not has_table_privilege('authenticated', 'public.ai_tyre_serial_review_events', 'insert')
  and not has_table_privilege('anon', 'public.ai_tyre_serial_readings', 'select'));
select pg_temp.ok('review RPC not executable by anon', not has_function_privilege('anon', 'public.ai_tyre_serial_review(uuid,text,text,text)', 'execute'));

-- ── reviewer reads and decisions ──────────────────────────────────────────────────────
select pg_temp.as_user('cccccccc-0000-4000-8000-000000000001');
select pg_temp.ok('KSA manager reads the readings', (select count(*) = 6 from public.ai_tyre_serial_readings));
select pg_temp.ok('KSA manager records a decision',
  (public.ai_tyre_serial_review((select id from public.ai_tyre_serial_readings where job_id = 'eeeeeeee-0000-4000-8000-000000000002'),
     'photo_shows_other_tyre', 'SYN-ALP-00003', 'Old tyre still visible in the photo')->>'ok') = 'true');
do $$ begin
  begin
    perform public.ai_tyre_serial_review((select id from public.ai_tyre_serial_readings limit 1), 'approve_and_update', null, 'nope');
    perform pg_temp.ok('unknown decision refused', false);
  exception when invalid_parameter_value then perform pg_temp.ok('unknown decision refused', true); end;
  begin
    perform public.ai_tyre_serial_review((select id from public.ai_tyre_serial_readings limit 1), 'dismissed', null, '');
    perform pg_temp.ok('reason required', false);
  exception when invalid_parameter_value then perform pg_temp.ok('reason required', true); end;
end $$;
select pg_temp.ok('decision is visible and attributed',
  (select count(*) = 1 from public.ai_tyre_serial_review_events where reviewer_id = 'cccccccc-0000-4000-8000-000000000001'));

select pg_temp.as_user('cccccccc-0000-4000-8000-000000000002');
select pg_temp.ok('UAE-only manager sees no KSA readings', (select count(*) = 0 from public.ai_tyre_serial_readings));
do $$ begin
  begin
    perform public.ai_tyre_serial_review('00000000-0000-0000-0000-000000000000'::uuid, 'dismissed', null, 'test');
    perform pg_temp.ok('UAE manager cannot decide on an unknown/out-of-scope reading', false);
  exception when others then perform pg_temp.ok('UAE manager cannot decide on an unknown/out-of-scope reading', true); end;
end $$;

select pg_temp.as_user('cccccccc-0000-4000-8000-000000000003');
select pg_temp.ok('Tyre Man cannot read the review evidence', (select count(*) = 0 from public.ai_tyre_serial_readings));
do $$ begin
  begin
    perform public.ai_tyre_serial_review('00000000-0000-0000-0000-000000000000'::uuid, 'dismissed', null, 'test');
    perform pg_temp.ok('Tyre Man cannot record a decision', false);
  exception when insufficient_privilege then perform pg_temp.ok('Tyre Man cannot record a decision', true); end;
end $$;

select pg_temp.as_user('cccccccc-0000-4000-8000-000000000004');
select pg_temp.ok('other company manager sees nothing', (select count(*) = 0 from public.ai_tyre_serial_readings)
  and (select count(*) = 0 from public.ai_tyre_serial_review_events));

select pg_temp.as_service();
select pg_temp.ok('reviewer decisions did not touch tyre records', (select h from tyre_before) = (select md5(string_agg(t::text, '|' order by id)) from public.tyre_records t));
select pg_temp.ok('reviewer decisions did not touch AI jobs', (select h from jobs_before) = (select md5(string_agg(j::text, '|' order by id)) from public.ai_tyre_inspection_jobs j));
rollback;
